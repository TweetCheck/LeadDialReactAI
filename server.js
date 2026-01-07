process.env.OTEL_SDK_DISABLED = 'true';
process.env.OTEL_TRACES_SAMPLER = 'always_off';
process.env.OTEL_METRICS_EXPORTER = 'none';
process.env.OTEL_LOGS_EXPORTER = 'none';

// This is crucial - prevents auto-instrumentation from loading
process.env.NODE_OPTIONS = (process.env.NODE_OPTIONS || '') + ' --no-node-snapshot';

import express from 'express';
import { runWorkflow,addLeadNote } from './index.js';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());
let apiUrl = process.env.API_URL || '';
//
// ✅ FIXED: Remove process.env.API_URL from route path
// Just use '/lead-details' 
app.post('/lead-details', async (req, res) => {
  try {
    const leadData = req.body;

    const {
      lead_id,
      booking_id,
      name,
      email,
      phone,
      lead_numbers_id,
      from_zip,
      to_zip,
      move_size,
      move_date,
      invoice_link ,
      payment_link,
      inventory_link,
      lead_status,
      sms_content
    } = req.body;

    const input_as_text = `${sms_content}`;
    //console.log('📨 Lead received:', lead_id);
    //console.log('🔧 Workflow input:', input_as_text);
    

    const workflowContext = {
      lead_id,
      lead_numbers_id,
      booking_id,
      name,
      email,
      phone,
      from_zip,
      to_zip,
      move_size,
      move_date,
      invoice_link,
      payment_link,
      inventory_link,
      lead_status
    };
    console.log('🔧 Workflow Context:', workflowContext);
    const result = await runWorkflow({
      input_as_text,
      context: workflowContext
    });
    console.log('🤖 Workflow result:', result);
    
    // Send SMS with note_type if available
    const smsParams = {
      lead_numbers_id: lead_numbers_id,
      content: result.response_text || 'No reply generated.',
      content_type: 'text' // Pass note_type if detected
    };

    const smsResult = await sendCustomerSMS(smsParams);

    res.status(200).json({
      success: true,
      message: 'Lead processed successfully',
      data: leadData,
      sdk_result: { response_text: result.response_text },
      sms_result: smsResult
    });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


async function sendCustomerSMS({ lead_numbers_id, content, content_type }) {
  const CONTROLLER_TIMEOUT_MS = 20000; // Timeout after 20 seconds

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONTROLLER_TIMEOUT_MS);

    const response = await fetch(
      `${apiUrl}/api/tenant/lead/send-customer-sms`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          lead_numbers_id,
          message: content,
          type: content_type
        }),
        signal: controller.signal // Add the abort signal
      }
    );

    clearTimeout(timeoutId); // Clear the timeout if the request succeeds
    const result = await response.json();
    console.log("📤 SMS API response:", result);
    return { success: true, result };

  } catch (error) {
    if (error.name === 'AbortError') {
      console.error(`❌ SMS request timed out after ${CONTROLLER_TIMEOUT_MS}ms`);
      return { 
        success: false, 
        error: `Request to SMS API timed out after ${CONTROLLER_TIMEOUT_MS}ms` 
      };
    } else {
      console.error("❌ Failed to send SMS:", error);
      return { success: false, error: error.message };
    }
  }
}


// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    service: 'Lead Dial API',
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Lead Dial API Server',
    endpoints: {
      'POST /lead-details': 'Process lead data',
      'GET /health': 'Health check'
    }
  });
});

// ✅ FIXED: Listen on 0.0.0.0 (not 127.0.0.1) so Nginx can reach it
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Node API running at http://0.0.0.0:${PORT}`);
  console.log(`📡 Local access: http://localhost:${PORT}`);
  console.log(`🔗 Endpoints:`);
  console.log(`   POST http://localhost:${PORT}/lead-details`);
  console.log(`   GET  http://localhost:${PORT}/health`);
});