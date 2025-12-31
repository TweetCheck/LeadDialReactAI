process.env.OTEL_SDK_DISABLED = 'true';
process.env.OTEL_TRACES_SAMPLER = 'always_off';
process.env.OPENAI_AGENTS_DISABLE_TELEMETRY = 'true';

// Prevent any telemetry loading
if (typeof process.env.NODE_OPTIONS === 'undefined') {
  process.env.NODE_OPTIONS = '--no-node-snapshot';
}

import 'dotenv/config';
import { tool, fileSearchTool, Agent, Runner, withTrace } from "@openai/agents";
import { z } from "zod";


// Tool definitions
let callCount = 0;
const addLeadNote = tool({
  name: "addLeadNote",
  description: "Add a short, structured note to the lead's record based on the SMS conversation without changing lead or booking fields.",
  parameters: z.object({
    lead_id: z.number(),
    lead_numbers_id: z.number(),
    note_type: z.string(),
    channel: z.string(),
    content: z.string()
  }),
  execute: async (input) => {
    callCount++;
    console.log(`🔢 Call #${callCount} to addLeadNote`);
    console.log("📝 Note content:", input.content);
    
    // Log stack trace to see who's calling
    if (callCount > 1) {
      console.trace("📞 Multiple calls detected from:");
    }
    
    // Add delay to see if calls are simultaneous
    await new Promise(resolve => setTimeout(resolve, 100));
    
    console.log("Note added:", input);

    const response = await fetch(
      "https://developer.leaddial.co/developer/api/tenant/lead/send-customer-sms",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          lead_numbers_id: input.lead_numbers_id,
          message: input.content,
          type: 'note'
        })
      }
    );

    const result = await response.json();
    console.log("📤 SMS response:", result);
    return { success: true, data: result };
  },
});

const updateLeadFields = tool({
  name: "updateLeadFields",
  description: "Update fields of a lead using its lead ID; only lead ID is required, other fields are optional and can be updated or inserted if not present.",
  parameters: z.object({
    lead_id: z.string(),
    name: z.string(),
    email: z.string(),
    from_zipcode: z.string(),
    to_zipcode: z.string(),
    move_date: z.string(),
    move_size: z.string()
  }),
  execute: async (input) => {
    console.log("Lead fields updated:", input);

    try {
      const response = await fetch("https://developer.leaddial.co/developer/api/tenant/lead/update-customer-info", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Add authorization if required
          // "Authorization": `Bearer ${process.env.EXTERNAL_API_TOKEN}`
        },
        body: JSON.stringify(input)
      });

      // First, get the raw text to see what's actually returned
      const responseText = await response.text();
      
      console.log("Response status:", response.status);
      console.log("Response headers:", Object.fromEntries(response.headers.entries()));
      console.log("Raw response (first 500 chars):", responseText.substring(0, 500));
      
      let result;
      try {
        // Try to parse as JSON
        result = JSON.parse(responseText);
      } catch (parseError) {
        console.error("Failed to parse JSON. Response appears to be HTML/error page.");
        console.error("Full response:", responseText);
        
        // Return structured error info
        return { 
          success: false, 
          error: "API returned non-JSON response", 
          status: response.status,
          message: "Received HTML/error page instead of JSON"
        };
      }
      
      console.log("External API response:", result);
      
      // Check if the API indicates failure
      if (!response.ok) {
        return { 
          success: false, 
          error: result.error || "API request failed", 
          status: response.status,
          data: result 
        };
      }
      
      return { success: true, data: result };
      
    } catch (error) {
      console.error("Failed to send lead update:", error);
      return { 
        success: false, 
        error: error.message,
        details: "Network or server error" 
      };
    }
  },
});

const sendPaymentLink = tool({
  name: "sendPaymentLink",
  description: "Send a payment link to the customer for a lead",
  parameters: z.object({
    lead_id: z.string(),
    payment_link: z.string()
  }),
  execute: async (input) => {
    console.log("Payment link sent:", input);
    return { success: true, payment_link: input.payment_link, formatted_for_customer: `Here is your payment link: ${input.payment_link}` };
    // TODO: Unimplemented
  },
});

const sendInvoiceLink = tool({
  name: "sendInvoiceLink",
  description: "Send an invoice link to the customer for a booked lead",
  parameters: z.object({
    lead_id: z.string(),
    invoice_link: z.string()
  }),
  execute: async (input) => {
    console.log("Invoice link sent:", input); 
    return { success: true, invoice_link: input.invoice_link,  formatted_for_customer: `Here is your invoice: ${input.invoice_link}` };
    // TODO: Unimplemented
  },
});

const sendInventoryLink = tool({
  name: "sendInventoryLink",
  description: "Generate and send an inventory form link to the customer",
  parameters: z.object({
    lead_id: z.string(),
    inventory_link: z.string()
  }),
  execute: async (input) => {
    console.log("Inventory link sent:", input);
    return { success: true, inventory_link: input.inventory_link,  formatted_for_customer: `Here is your inventory form: ${input.inventory_link}` };
    // TODO: Unimplemented
  },
});

const fileSearch = fileSearchTool([
  "vs_69446993e57c8191a7a96b38f1f3bdc3"
])

const maSmsagent = new Agent({
  name: "MA SMSAgent",
  instructions: `You are MovingAlly_SMS_Agent, the official SMS/WhatsApp agent for Moving Ally.
Always greet the customer using their name if available in CRM.

You help customers with quotes, bookings, payments, invoices, inventory, and issues.

--------------------------------------------------
COMMUNICATION RULES
--------------------------------------------------
- SMS/WhatsApp only
- Plain text only
- 1–2 short sentences per reply
- NEVER show tool names, tool data, JSON, or system text to the customer
- NEVER include words like “Tool Calls” or “Customer Message” in replies
- Never mention tools, systems, APIs, backend logic, or internal processes
- Never guess, promise, or invent details

--------------------------------------------------
DATA FORMAT RULES
--------------------------------------------------
- Move Size MUST be exactly:
  Studio, 1 Bedroom, 2 Bedrooms, 3 Bedrooms, 4 Bedrooms, 5+ Bedrooms
- move_date MUST be YYYY-MM-DD

Use ONLY the CRM context provided.

--------------------------------------------------
LEAD STATUS DEFINITIONS (AUTHORITATIVE)
--------------------------------------------------
Possible lead_status values:
- not_booked
- quote_generated
- quote_sent
- booked

You MUST rely only on the provided lead_status.

--------------------------------------------------
ABSOLUTE ACTION RULE (HIGHEST PRIORITY)
--------------------------------------------------
If the customer instruction is CLEAR AND the action is allowed under the rules below,
you MUST ACT.

You are FORBIDDEN from:
- Re-asking known information
- Asking booking status
- Asking for phone or email
- Narrating actions
- Delaying execution

You may ask questions ONLY when:
- Required information is missing
- Action is not allowed and escalation is required

--------------------------------------------------
PAYMENT vs INVOICE (STRICT, MULTI-STATUS)
--------------------------------------------------
IF lead_status = \"booked\":
- Payment is already completed
- PAYMENT LINKS are FORBIDDEN
- ONLY invoice / receipt may be sent

IF lead_status IN (\"quote_generated\", \"quote_sent\"):
- Payment link MAY be sent

IF lead_status = \"not_booked\":
- Payment link is NOT allowed
- Quote is not ready

--------------------------------------------------
PAYMENT REQUEST HANDLING
--------------------------------------------------
If the customer asks for payment or a payment link:

CASE 1 — lead_status = \"quote_generated\" OR \"quote_sent\":
→ Call send_payment_link
→ Log ONE add_lead_note (ai_general)
→ Reply with the payment link

CASE 2 — lead_status = \"not_booked\":
- DO NOT send payment link

You MUST:
→ Log ONE add_lead_note (ai_issue)
→ Reply:
\"Your moving quote hasn’t been generated yet, so I can’t send a payment link right now. Our team will follow up to get this ready.\"

CASE 3 — lead_status = \"booked\":
- DO NOT send payment link
→ Reply:
\"Your move is already paid for since it’s booked. Would you like me to send you the invoice?\"

--------------------------------------------------
INVOICE (BOOKED LEADS ONLY)
--------------------------------------------------
If the customer asks for invoice, bill, billing, receipt, or final invoice:

IF lead_status = \"booked\":
→ Call send_invoice_link
→ Log ONE add_lead_note (ai_general)
→ Reply with the invoice link

IF lead_status != \"booked\":
→ Reply:
\"An invoice is available only after a booking is completed.\"

--------------------------------------------------
INVENTORY HANDLING (STRICT, STATUS-BASED)
--------------------------------------------------
Inventory can be added or updated ONLY when:
- lead_status = \"not_booked\"

IF lead_status = \"not_booked\" AND customer asks to add/update inventory:
→ Call send_inventory_link
→ Log ONE add_lead_note (ai_general)
→ Reply with the inventory link

--------------------------------------------------
INVENTORY RESTRICTIONS
--------------------------------------------------
IF lead_status IN (\"quote_generated\", \"quote_sent\", \"booked\") AND customer asks about inventory:

- NEVER send inventory link
- NEVER collect inventory in chat

You MUST:
→ Log ONE add_lead_note (ai_change_request)
→ Reply:
\"I’ve noted your inventory request and shared it with the team for review.\"

--------------------------------------------------
LEAD HANDLING
--------------------------------------------------
- Phone number ALWAYS resolves the lead
- Never ask for lead_id, quote number, or confirmation number
- CRM context is authoritative

--------------------------------------------------
BOOKED LEADS (NON-PAYMENT / NON-INVENTORY)
--------------------------------------------------
If lead_status = \"booked\":
- NEVER call update_lead
- NEVER ask for update details
- Any change request → log ONE add_lead_note only

--------------------------------------------------
NOT BOOKED LEADS – STRUCTURED UPDATES
--------------------------------------------------
If lead_status = \"not_booked\" AND customer provides clear update info
(e.g., move date, move size, from ZIP, to ZIP):

→ Call update_lead immediately
→ Log ONE add_lead_note (ai_update_details)

--------------------------------------------------
ESCALATION & FOLLOW-UP RULE (CRITICAL)
--------------------------------------------------
Whenever you tell the customer that:
- the team will follow up
- an agent will review or get back
- the issue needs manual handling

You MUST:
→ Log ONE add_lead_note in clear, normal language
→ Describe exactly what the customer requested
→ Describe what the team needs to do next

--------------------------------------------------
NOTE CONTENT GENERATION RULE (CRITICAL)
--------------------------------------------------
Before calling add_lead_note, you MUST first generate
a short, plain-English summary of the action or escalation.

The note content MUST:
- Be 1–2 sentences
- Clearly state what the customer asked for
- Clearly state what action was taken OR what the team must do next
- Be understandable by any human agent without extra context

The note content MUST NOT:
- Be empty
- Contain tool names
- Contain JSON
- Contain system or backend language

If you cannot generate meaningful note content,
you MUST NOT call add_lead_note.

--------------------------------------------------
NOTES (STRICT – FINAL FORM)
--------------------------------------------------
Notes must ALWAYS be:
- Short
- Written in plain English
- Actionable by a human agent

Notes must NEVER include:
- Tool names
- Parameters
- JSON
- System instructions
- Repeated boilerplate text

--------------------------------------------------
TOOL EXECUTION RULES
--------------------------------------------------
- Tools must execute silently
- Tool details must NEVER appear in customer messages
- If no tool is required, simply reply to the customer normally

--------------------------------------------------
LINK RETURN RULE (MANDATORY)
--------------------------------------------------
If a tool returns a link (payment, invoice, inventory),
you MUST include that link directly in the SMS reply.

You are FORBIDDEN from:
- Saying a link was sent without showing it
- Modifying, shortening, or guessing links
`,
  model: "gpt-5.2",
  tools: [
    addLeadNote,
    updateLeadFields,
    sendPaymentLink,
    sendInvoiceLink,
    sendInventoryLink,
    fileSearch
  ],
  modelSettings: {
    parallelToolCalls: true,
    reasoning: {
      effort: "medium",
      summary: "auto"
    },
    store: true
  }
});


// work
// Main code entrypoint
// In index.js - modify runWorkflow to format properly
export const runWorkflow = async (workflow) => {
  console.log(`[runWorkflow] Starting for lead ${workflow.context?.lead_id || 'unknown'}`);
  
  const WORKFLOW_TIMEOUT_MS = 30000; // 30 seconds
  
  try {
    const conversationHistory = [
      { 
        role: "user", 
        content: [
          { 
            type: "input_text", 
            text: `CRM Context: ${JSON.stringify(workflow.context || {})}\n\nCustomer Message: ${workflow.input_as_text}`
          }
        ] 
      }
    ];
    
    const runner = new Runner();
    
    // ⭐ ADD TIMEOUT
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Workflow timeout after ${WORKFLOW_TIMEOUT_MS}ms`));
      }, WORKFLOW_TIMEOUT_MS);
    });
    
    const maSmsagentResultTemp = await Promise.race([
      runner.run(maSmsagent, conversationHistory, [...conversationHistory]),
      timeoutPromise
    ]);
    
    if (!maSmsagentResultTemp?.finalOutput) {
      throw new Error("Agent returned no output");
    }
    
    let finalOutput = maSmsagentResultTemp.finalOutput;
    
    console.log(`[runWorkflow] ✅ Completed`);
    
    return {
      response_text: finalOutput
    };
    
  } catch (error) {
    console.error(`[runWorkflow] ❌ Error:`, error.message);
    
    // Return fallback that won't confuse the customer
    return {
      response_text: `NO TOOL CALL NEEDED\n\nCustomer Message: I've received your message and will process it shortly.`
    };
  }
};

export { addLeadNote, maSmsagent, updateLeadFields, sendPaymentLink, sendInvoiceLink, sendInventoryLink, fileSearch };