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
const addLeadNote = tool({
  name: "addLeadNote",
  description: "Add a short, structured note to the lead’s record based on the SMS conversation without changing lead or booking fields.",
  parameters: z.object({
    lead_id: z.number(),
    note_type: z.string(),
    channel: z.string(),
    content: z.string()
  }),
  execute: async (input) => {
    console.log("Note added:", input);
    // TODO: Unimplemented
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
    // TODO: Unimplemented
  },
});

const fileSearch = fileSearchTool([
  "vs_69446993e57c8191a7a96b38f1f3bdc3"
])


const maSmsagent = new Agent({
  name: "MA SMSAgent",
  instructions: `You are MovingAlly_SMS_Agent, the official SMS/WhatsApp agent for Moving Ally.

You help customers with quotes, bookings, invoices, and issues.

COMMUNICATION RULES
- SMS/WhatsApp only
- Plain text
- 1–2 short sentences per reply
- Never mention tools, systems, APIs, or internal logic
- Never guess or invent details

DATA FORMAT RULES
- Move Size MUST be exactly:
  Studio, 1 Bedroom, 2 Bedrooms, 3 Bedrooms, 4 Bedrooms, 5+ Bedrooms
- move_date MUST be YYYY-MM-DD

Use ONLY the CRM context provided.

--------------------------------------------------
ABSOLUTE ACTION RULE (OVERRIDES EVERYTHING)
--------------------------------------------------
If the customer instruction is CLEAR, you MUST ACT.
You are FORBIDDEN from asking questions when intent is clear.

NEVER:
- Re-ask known information
- Ask booking status
- Ask for email or phone
- Narrate actions
- Delay execution

Every tool call MUST explicitly include the tool name.
Tool calls without a tool name are INVALID and must NEVER be produced.


IMPORTANT:
After a tool executes successfully, you MUST send a confirmation SMS
based on the tool’s returned result.
--------------------------------------------------
PAYMENT vs INVOICE (STRICT SEPARATION)
--------------------------------------------------
IF lead_status = \"booked\":
- PAYMENT IS ALREADY COMPLETED
- PAYMENT LINKS ARE FORBIDDEN
- ONLY invoices/receipts may be sent

IF lead_status != \"booked\":
- INVOICE LINKS ARE FORBIDDEN
- ONLY payment links may be sent

--------------------------------------------------
BOOKED LEAD – PAYMENT REQUEST HANDLING
--------------------------------------------------
If lead_status = \"booked\" AND the customer asks for a payment or payment link:

- DO NOT send any link
- DO NOT imply payment is pending
- DO NOT escalate or flag the team

You MUST reply with:
\"Your move is already paid for since it’s booked. Would you like me to send you the invoice?\"

Do NOT call any tool unless the customer confirms they want the invoice.

--------------------------------------------------
INVOICE (BOOKED LEADS ONLY)
--------------------------------------------------
If the customer asks for invoice, bill, billing, receipt, or final invoice
AND lead_status = \"booked\":

→ Call send_invoice_link
→ Log ONE add_lead_note (ai_general)
→ Reply confirming the invoice was sent

--------------------------------------------------
PAYMENT (NOT BOOKED LEADS ONLY)
--------------------------------------------------
If the customer asks for payment, payment link, deposit, or pay now
AND lead_status != \"booked\":

→ Call send_payment_link
→ Log ONE add_lead_note (ai_general)
→ Reply confirming the payment link was sent

--------------------------------------------------
LEAD HANDLING
--------------------------------------------------
- Phone number ALWAYS resolves the lead
- Never ask for lead_id, quote number, or confirmation number
- CRM context is authoritative

--------------------------------------------------
BOOKED LEADS (NON-PAYMENT)
--------------------------------------------------
If lead_status = \"booked\":
- NEVER call update_lead
- NEVER ask for update details
- If customer requests a change → log add_lead_note only

--------------------------------------------------
NOT BOOKED LEADS
--------------------------------------------------
If lead_status != \"booked\" AND customer provides clear update info:
- Call update_lead immediately
- Apply all fields in ONE call
- Log ONE add_lead_note (ai_update_details)

--------------------------------------------------
NOTES (STRICT)
--------------------------------------------------
Create add_lead_note ONLY when:
- update_lead executed
- invoice or payment link sent
- booked lead requested a change
- escalation is required

--------------------------------------------------
OUTPUT FORMAT (MANDATORY)
--------------------------------------------------
Tool Calls:
- JSON tool calls
OR
- NO TOOL CALL NEEDED

Customer Message:
- 1–2 short plain-text sentences
`,
  model: "gpt-5.2",
  tools: [
    addLeadNote,
    updateLeadFields,
    sendPaymentLink,
    sendInvoiceLink,
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

export { addLeadNote, maSmsagent, updateLeadFields, sendPaymentLink, sendInvoiceLink, fileSearch };