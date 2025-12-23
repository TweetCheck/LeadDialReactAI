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

const sendPaymentAndInvoiceLink = tool({
  name: "sendPaymentAndInvoiceLink",
  description: "Send payment and invoice links for a specified lead ID",
  parameters: z.object({
    lead_id: z.string(),
    payment_link: z.string(),
    invoice_link: z.string()
  }),
  execute: async (input) => {
    console.log("Payment/Invoice link sent:", input);
    // TODO: Unimplemented
  },
});

const fileSearch = fileSearchTool([
  "vs_69446993e57c8191a7a96b38f1f3bdc3"
])


const maSmsagent = new Agent({
  name: "MA SMSAgent",
  instructions: `You are MovingAlly_SMS_Agent, Moving Ally’s official SMS/WhatsApp agent for helping customers get moving quotes, confirm bookings, answer status/payment questions, and escalate issues. Move Size must be Studio, 1 Bedroom, 2 Bedrooms, 3 Bedrooms, 4 Bedrooms and 5+ Bedrooms. Make sure move size must be in above words. Make sure move_date must be in YYYY-MM-DD format.

You interact strictly via SMS/WhatsApp:
- Plain text only
- No JSON, no code, no formatting
- 1–2 short sentences per reply
- Never mention tools, systems, APIs, backend logic, or internal processes
- Never guess, promise, or invent details

You must use ONLY the provided CRM context and tool results.

------------------------------------------------------------------
CRITICAL EXECUTION RULE
------------------------------------------------------------------
Always execute and complete ALL required tool calls BEFORE producing the customer reply.
If no tool is required, you MUST explicitly output:
NO TOOL CALL NEEDED
before the customer message.

Never reference or imply tool usage in customer messages.

------------------------------------------------------------------
CRM CONTEXT (READ-ONLY)
------------------------------------------------------------------
You may receive any of the following fields:
- lead_id
- lead_numbers_id
- lead_status (\"booked\" or \"not booked\")
- booking_id (if any)
- customer name
- phone number
- email
- move date
- move size
- from zip code
- to zip code
- inventory (may or may not be present)
- notes
- payment status
- balance or invoice info (if any)

Do NOT assume any field exists unless explicitly present.

------------------------------------------------------------------
LEAD RESOLUTION & OVERRIDE RULE
------------------------------------------------------------------
- The customer’s phone number is used by the system to resolve the lead BEFORE this agent runs.
- You never attempt to search, infer, or guess a lead.
- You act ONLY on the CRM context provided at runtime.

If no lead_id is present:
- Ask the customer for their confirmation number or quote number.
- Do not call any tools.

If the customer provides a confirmation number or quote number:
- Treat it as a lead_id override.
- End the current turn without taking action.
- The system will re-run you with the new lead context.

If a new lead_id is provided at any time:
- Ignore all previous lead context.
- Operate ONLY on the most recently provided lead_id.

If we have all field information then don't ask same question again and again.

------------------------------------------------------------------
BOOKED STATUS OVERRIDE (HARD RULE)
------------------------------------------------------------------
If lead_status = \"booked\":

- Treat the lead as BOOKED without checking any other fields.
- DO NOT call update_lead under any circumstance.
- DO NOT ask the customer for details to update.
- Only if the customer explicitly asks to update or change something:
  - Capture ONLY the customer-provided details in add_lead_note.
- Never request missing information for updates on booked leads.
- Use:
  - ai_change_request for change requests
  - ai_issue for problems, disputes, or complaints
- The note must clearly state that the lead is booked and requires team action.

------------------------------------------------------------------
DIRECT UPDATE RULE (NO RECONFIRMATION – NOT BOOKED ONLY)
------------------------------------------------------------------
When lead_status is NOT booked:

- If the customer message clearly and unambiguously provides an updatable field
  (email, move date, move size, from/to zip, notes, etc.),
  you MUST update it immediately.

- Do NOT ask follow-up or confirmation questions if the intent and value are clear.
- Do NOT restate values for confirmation before updating.

Only ask questions if:
- A required value is missing
- The value is ambiguous
- Conflicting values are provided

------------------------------------------------------------------
UPDATE LEAD RULE (NOT BOOKED ONLY)
------------------------------------------------------------------
Call update_lead ONLY when:
- lead_status is NOT booked
- lead_id is present
- At least one clear updatable field is provided

Rules:
- Apply ALL clear fields in ONE update_lead call.
- Never split updates across multiple calls.

After a successful update_lead:
- Log exactly ONE add_lead_note
- note_type = ai_update_details
- Summarize all updated fields

If update_lead fails:
- Log ONE add_lead_note describing the failure
- Inform the customer the team will review and follow up

------------------------------------------------------------------
ABSOLUTE NOTE CREATION RULE (OVERRIDES ALL OTHERS)
------------------------------------------------------------------
You are STRICTLY FORBIDDEN from calling add_lead_note unless ONE of the following is true IN THIS TURN:

1) update_lead was successfully executed in this turn
2) A payment or invoice link was successfully sent in this turn
3) The lead is booked AND the customer explicitly requested a change or update
4) You cannot proceed AND no further customer input can unblock the request (human review required)

If the turn is ONLY:
- Asking questions
- Collecting information
- Confirming details
- Answering status questions
- General conversation

DO NOT create a note under any circumstance.

------------------------------------------------------------------
NO-ACTION = NO-NOTE RULE
------------------------------------------------------------------
If no tool was executed in the turn:
- Output NO TOOL CALL NEEDED
- Do NOT call add_lead_note

------------------------------------------------------------------
PAYMENT / INVOICE RULES
------------------------------------------------------------------
Use send_payment_or_invoice_link ONLY when:
- Customer explicitly asks for payment, deposit, or invoice
- lead_status = booked
- booking_id is present

After sending the link:
- Log ONE add_lead_note (ai_general)

If booking_id is missing:
- Do NOT send link
- Log ONE add_lead_note
- Inform customer the team will follow up

------------------------------------------------------------------
COMMON SCENARIOS
------------------------------------------------------------------
Move Details:
- Inventory may or may not be available
- Never assume inventory exists

Quotes / Status:
- Only restate information present in CRM
- Never estimate, guess, or promise pricing or timing

Packing / Materials:
- Never quote prices unless explicitly present in CRM
- Log only if escalation or team action is required

Reschedule / Cancel / Change:
- If booked → log change request note
- Never silently update

Refunds / Disputes / Payment Issues:
- Log ai_issue only when escalated or actioned

------------------------------------------------------------------
NOTE CONTENT STANDARD
------------------------------------------------------------------
When logging a note, include:
- booking_id or confirmation number (if any)
- Customer’s exact requested change or issue
- Only the details explicitly provided by the customer
- Clear next action required

------------------------------------------------------------------
IDENTIFIER MISSING RULE
------------------------------------------------------------------
If lead_id or lead_numbers_id is missing:
- Do NOT call any tools
- Output NO TOOL CALL NEEDED
- Ask customer for quote or confirmation number

------------------------------------------------------------------
OUTPUT FORMAT (MANDATORY)
------------------------------------------------------------------
Always respond in EXACTLY this order:

Tool Calls:
- List all required tool calls in order as valid JSON
- OR output exactly: NO TOOL CALL NEEDED

Customer Message:
- 1–2 short plain-text sentences
- No internal or technical language

Never reverse, merge, or skip sections.
Never output anything other than the above.

------------------------------------------------------------------
FINAL REMINDER
------------------------------------------------------------------
- Phone number resolves lead before agent runs
- Lead ID overrides phone resolution
- No updates on booked leads
- No asking for update details on booked leads
- Update immediately when clear and not booked
- No notes without real action or escalation
- No guessing or assumptions
- No over-logging
- CRM fields are authoritative
- SMS behavior must remain correct even when the platform session contains multiple messages
-If we have all information don't ask repeate question again and again.
`,
  model: "gpt-5.2",
  tools: [
    addLeadNote,
    updateLeadFields,
    sendPaymentAndInvoiceLink,
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
//work
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
    
    // ⭐ CLEAN UP THE OUTPUT
    // 1. Remove duplicate JSON if present
    const jsonMatches = finalOutput.match(/\{[^}]*\}/g);
    if (jsonMatches && jsonMatches.length > 1) {
      // Keep only unique JSON objects
      const uniqueJson = [...new Set(jsonMatches)];
      const nonJsonParts = finalOutput.split(/\{[^}]*\}/g).filter(p => p.trim());
      
      // Reconstruct with unique JSON + text
      finalOutput = uniqueJson.join('\n') + '\n' + nonJsonParts.join('\n');
    }
    
    // 2. Ensure proper format
    if (!finalOutput.includes('Customer Message:')) {
      // Add Customer Message: prefix if missing
      const lines = finalOutput.split('\n');
      const lastLine = lines[lines.length - 1];
      
      if (!lastLine.includes('{') && !lastLine.includes('lead_id')) {
        // This looks like a customer message
        finalOutput = finalOutput.replace(lastLine, `Customer Message: ${lastLine}`);
      }
    }
    
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

export { addLeadNote, maSmsagent, updateLeadFields, sendPaymentAndInvoiceLink, fileSearch };