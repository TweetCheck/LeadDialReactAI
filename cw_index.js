import { tool, fileSearchTool, Agent, Runner, withTrace } from "@openai/agents";
import { z } from "zod";
import "dotenv/config";
import { OpenAI } from "openai";
import { runGuardrails } from "@openai/guardrails";

let hasLoggedNote = false;
let CW_API_URL = process.env.CW_API_URL || '';
// Tool definitions
const addLeadNote = tool({
  name: "addLeadNote",
  description: "Add a short, structured note to the lead’s record based on the SMS conversation without changing lead or booking fields or inform about the update.",
  parameters: z.object({
    lead_id: z.number(),
    lead_numbers_id: z.number(),
    note_type: z.string(),
    channel: z.string(),
    content: z.string()
  }),
  execute: async (input) => {
    // ⛔ THE FIX: If we already logged a note, stop immediately.
    if (hasLoggedNote) {
      console.warn("🚫 BLOCKED: addLeadNote called multiple times. Ignoring this call.");
      return { success: false, reason: "Duplicate note blocked by system guard" };
    }

    // Set the flag so we know a note has been sent
    hasLoggedNote = true; 

    callCount++;
    console.log(`🔢 Call #${callCount} to addLeadNote (Allowed)`);
    console.log("📝 Note content:", input.content);
    
    // Log stack trace only if something went wrong (optional)
    // if (callCount > 1) { console.trace("📞 Multiple calls detected from:"); }
    
    // Add delay to see if calls are simultaneous
    await new Promise(resolve => setTimeout(resolve, 100));
    
    console.log("Note added:", input);

    const response = await fetch(
      `${CW_API_URL}/api/tenant/lead/send-customer-sms`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          lead_numbers_id: input.lead_numbers_id,
          message: input.content, // ⚠️ SEE WARNING BELOW
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
  description: "Update fields of a lead based on the given lead_id",
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
      const response = await fetch(`${CW_API_URL}/api/tenant/lead/update-customer-info`, {
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
    console.log("Send Payment Link Tool called with input:", input);
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
    console.log("Send Invoice Link Tool called with input:", input);
    return { success: true, invoice_link: input.invoice_link,  formatted_for_customer: `Here is your invoice: ${input.invoice_link}` };
    // TODO: Unimplemented
  },
});
const fileSearch = fileSearchTool([
  "vs_69446993e57c8191a7a96b38f1f3bdc3"
])

// Shared client for guardrails and file search
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Guardrails definitions
const guardrailsConfig = {
  guardrails: [
    { name: "Moderation", config: { categories: ["sexual/minors", "hate/threatening", "harassment/threatening", "self-harm/instructions", "violence/graphic", "illicit/violent"] } },
    { name: "Jailbreak", config: { model: "gpt-4.1-mini", confidence_threshold: 0.7 } },
    { name: "NSFW Text", config: { model: "gpt-4.1-mini", confidence_threshold: 0.7 } }
  ]
};
const context = { guardrailLlm: client };

function guardrailsHasTripwire(results) {
    return (results ?? []).some((r) => r?.tripwireTriggered === true);
}

function getGuardrailSafeText(results, fallbackText) {
    for (const r of results ?? []) {
        if (r?.info && ("checked_text" in r.info)) {
            return r.info.checked_text ?? fallbackText;
        }
    }
    const pii = (results ?? []).find((r) => r?.info && "anonymized_text" in r.info);
    return pii?.info?.anonymized_text ?? fallbackText;
}

async function scrubConversationHistory(history, piiOnly) {
    for (const msg of history ?? []) {
        const content = Array.isArray(msg?.content) ? msg.content : [];
        for (const part of content) {
            if (part && typeof part === "object" && part.type === "input_text" && typeof part.text === "string") {
                const res = await runGuardrails(part.text, piiOnly, context, true);
                part.text = getGuardrailSafeText(res, part.text);
            }
        }
    }
}

async function scrubWorkflowInput(workflow, inputKey, piiOnly) {
    if (!workflow || typeof workflow !== "object") return;
    const value = workflow?.[inputKey];
    if (typeof value !== "string") return;
    const res = await runGuardrails(value, piiOnly, context, true);
    workflow[inputKey] = getGuardrailSafeText(res, value);
}

async function runAndApplyGuardrails(inputText, config, history, workflow) {
    const guardrails = Array.isArray(config?.guardrails) ? config.guardrails : [];
    const results = await runGuardrails(inputText, config, context, true);
    const shouldMaskPII = guardrails.find((g) => (g?.name === "Contains PII") && g?.config && g.config.block === false);
    if (shouldMaskPII) {
        const piiOnly = { guardrails: [shouldMaskPII] };
        await scrubConversationHistory(history, piiOnly);
        await scrubWorkflowInput(workflow, "input_as_text", piiOnly);
        await scrubWorkflowInput(workflow, "input_text", piiOnly);
    }
    const hasTripwire = guardrailsHasTripwire(results);
    const safeText = getGuardrailSafeText(results, inputText) ?? inputText;
    return { results, hasTripwire, safeText, failOutput: buildGuardrailFailOutput(results ?? []), passOutput: { safe_text: safeText } };
}

function buildGuardrailFailOutput(results) {
    const get = (name) => (results ?? []).find((r) => ((r?.info?.guardrail_name ?? r?.info?.guardrailName) === name));
    const pii = get("Contains PII"), mod = get("Moderation"), jb = get("Jailbreak"), hal = get("Hallucination Detection"), nsfw = get("NSFW Text"), url = get("URL Filter"), custom = get("Custom Prompt Check"), pid = get("Prompt Injection Detection"), piiCounts = Object.entries(pii?.info?.detected_entities ?? {}).filter(([, v]) => Array.isArray(v)).map(([k, v]) => k + ":" + v.length), conf = jb?.info?.confidence;
    return {
        pii: { failed: (piiCounts.length > 0) || pii?.tripwireTriggered === true, detected_counts: piiCounts },
        moderation: { failed: mod?.tripwireTriggered === true || ((mod?.info?.flagged_categories ?? []).length > 0), flagged_categories: mod?.info?.flagged_categories },
        jailbreak: { failed: jb?.tripwireTriggered === true },
        hallucination: { failed: hal?.tripwireTriggered === true, reasoning: hal?.info?.reasoning, hallucination_type: hal?.info?.hallucination_type, hallucinated_statements: hal?.info?.hallucinated_statements, verified_statements: hal?.info?.verified_statements },
        nsfw: { failed: nsfw?.tripwireTriggered === true },
        url_filter: { failed: url?.tripwireTriggered === true },
        custom_prompt_check: { failed: custom?.tripwireTriggered === true },
        prompt_injection: { failed: pid?.tripwireTriggered === true },
    };
}


const countrywideSmsAgnet = new Agent({
  name: "Countrywide SMS Agnet",
  instructions: `You are Countrywide_SMS_Agent, the official SMS/WhatsApp agent for Countrywide.
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
- NEVER tell the customer to contact us
- NEVER ask the customer to call, email, or reach out

If the customer needs to speak with a human:
- Always say: \"Our representative will get in touch with you.\"
- Do NOT promise timing
- Do NOT provide contact details

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
REQUIRED CUSTOMER DETAILS – GATING RULE
--------------------------------------------------
If NONE or SOME of the following information is available in CRM or the conversation:
- Customer name
- Move date
- Move size
- From ZIP
- To ZIP

You MUST:
- Ask only for the missing details
- Ask in a single, polite message
- Keep it to 1–2 short sentences
- NOT proceed with quotes, payments, invoices, inventory handling, or escalation

When requesting missing details:
- Ask only for what is missing
- Combine multiple fields into one message when possible
- Do NOT explain internal reasons or processes

IMPORTANT CLARIFICATION (CRITICAL):
While required customer details are still missing:
- NEVER say information was shared with the team
- NEVER say a representative will get in touch
- NEVER log escalation, issue, or change-request notes
- ONLY acknowledge received info and ask for remaining missing details

--------------------------------------------------
PARTIAL UPDATE RULE (CRITICAL – NOT BOOKED LEADS)
--------------------------------------------------
If lead_status = \"not_booked\" AND the customer provides ANY valid structured move detail
(move date, move size, from ZIP, or to ZIP):

You MUST:
- Call update_lead immediately with the provided information
- Log ONE add_lead_note (ai_update_details)
- NOT use escalation or representative language
- Then ask ONLY for the remaining missing required details

This applies EVEN IF other required details are still missing.

Once ALL required details are available:
- Immediately proceed with the applicable action rules
- Do NOT re-ask for information already provided

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
\"Your moving quote hasn’t been generated yet, so I can’t send a payment link right now. Our representative will get in touch with you.\"

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
INVENTORY HANDLING – COUNTRYWIDE
--------------------------------------------------
- There is NO inventory link for Countrywide
- Inventory is NEVER collected via SMS or WhatsApp

IF the customer mentions or asks about inventory (ANY lead_status):

You MUST:
→ Log ONE add_lead_note (ai_change_request)
→ Clearly capture all inventory details the customer mentioned
→ Reply:
\"I’ve noted all the inventory details you shared, and our representative will get back to you.\"

INVENTORY RULES (ABSOLUTE):
- NEVER send an inventory link
- NEVER ask inventory follow-up questions
- NEVER promise timing or outcomes
- NEVER ask the customer to contact us

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
ESCALATION & FOLLOW-UP RULE (CRITICAL)
--------------------------------------------------
Escalation depends on lead_status and action type.

IF lead_status = \"not_booked\":
- NEVER escalate for update requests
- NEVER say a representative will get back to you
- ALWAYS directly update the lead when the customer provides valid details
- Log add_lead_note ONLY when required by update rules

IF lead_status IN (\"quote_generated\", \"quote_sent\", \"booked\"):
Escalation IS REQUIRED when:
- The customer requests changes or updates
- The issue needs manual handling
- The agent cannot directly perform the requested action

In these cases, you MUST:
→ Log ONE add_lead_note in clear, normal language
→ Clearly describe what the customer requested
→ Clearly describe what the team needs to do next
→ Reply to the customer:
\"Our representative will get back to you.\"

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
If a tool returns a link (payment or invoice),
you MUST include that link directly in the SMS reply.

You are FORBIDDEN from:
- Saying a link was sent without showing it
- Modifying, shortening, or guessing links

--------------------------------------------------
OUTPUT FORMAT (MANDATORY)
--------------------------------------------------
Always respond in EXACTLY this order:

Tool Calls:
- List all required tool calls in order as valid JSON
- OR output exactly: NO TOOL CALL NEEDED

Customer Message:
- 1–2 short plain-text sentences
- No internal or technical language

Never reverse, merge, or skip sections.
Never output anything other than the above.
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

const countrywideFailedSms = new Agent({
  name: "Countrywide Failed SMS",
  instructions: `You are a system error response agent.

Your ONLY job is to return the following message exactly as written:

\"Please ask a valid question.\"

Do not ask questions.
Do not explain.
Do not add any extra text.
Do not use tools.
Return only the message.
`,
  model: "gpt-5.2",
  modelSettings: {
    reasoning: {
      effort: "low",
      summary: "auto"
    },
    store: true
  }
});


// Main code entrypoint
export const runWorkflowCw = async (workflow) => {
  return await withTrace("Countrywide SMS Stage", async () => {
    const state = {

    };
    hasLoggedNote = false;
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
    const runner = new Runner({
      traceMetadata: {
        __trace_source__: "agent-builder",
        workflow_id: "wf_695c036f88f08190a2e88aa433377cf20aab5674a70b7a20"
      }
    });
    const guardrailsInputText = workflow.input_as_text;
    const { hasTripwire: guardrailsHasTripwire, safeText: guardrailsAnonymizedText, failOutput: guardrailsFailOutput, passOutput: guardrailsPassOutput } = await runAndApplyGuardrails(guardrailsInputText, guardrailsConfig, conversationHistory, workflow);
    const guardrailsOutput = (guardrailsHasTripwire ? guardrailsFailOutput : guardrailsPassOutput);
    if (guardrailsHasTripwire) {
      const countrywideFailedSmsResultTemp = await runner.run(
        countrywideFailedSms,
        [
          ...conversationHistory
        ]
      );
      conversationHistory.push(...countrywideFailedSmsResultTemp.newItems.map((item) => item.rawItem));

      if (!countrywideFailedSmsResultTemp.finalOutput) {
          throw new Error("Agent result is undefined");
      }

      const countrywideFailedSmsResult = {
        output_text: countrywideFailedSmsResultTemp.finalOutput ?? ""
      };
      return countrywideFailedSmsResult;
    } else {
      const countrywideSmsAgnetResultTemp = await runner.run(
        countrywideSmsAgnet,
        [
          ...conversationHistory
        ]
      );

      if (!countrywideSmsAgnetResultTemp.finalOutput) {
          throw new Error("Agent result is undefined");
      }

      const countrywideSmsAgnetResult = {
        output_text: countrywideSmsAgnetResultTemp.finalOutput ?? ""
      };
      const endResult = {
        response_text: countrywideSmsAgnetResult.output_text
      };
      return endResult;
    }
  });
}
