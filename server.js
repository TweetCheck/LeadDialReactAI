import express from 'express';
import { runWorkflow } from './index.js';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

// ✅ FIXED: Remove process.env.API_URL from route path
// Just use '/lead-details' 
app.post('/lead-details', async (req, res) => {
  try {
    const leadData = req.body;

    const {
      lead_id,
      lead_numbers_id,
      from_zip,
      to_zip,
      move_size_id,
      move_date,
      payment_link,
      sms_content
    } = req.body;

    const input_as_text = `${sms_content} from ${from_zip} to ${to_zip} lead_id: ${lead_id} lead_numbers_id: ${lead_numbers_id} move_size: ${move_size_id} move_date: ${move_date} payment_link: ${payment_link}`;
    
    console.log('📨 Lead received:', lead_id);
    console.log('🔧 Workflow input:', input_as_text);

    const result = await runWorkflow({
      input_as_text
    });

    const smsResult = await sendCustomerSMS({
      lead_numbers_id: lead_numbers_id,
      content: result.reply_text || 'No reply generated.'
  });

    res.status(200).json({
      success: true,
      message: 'Lead processed successfully',
      data: leadData,
      sdk_result: result,
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


async function sendCustomerSMS({ lead_numbers_id, content }) {
  try {
    const response = await fetch(
      "https://developer.leaddial.co/developer/api/tenant/lead/send-customer-sms",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // "Authorization": `Bearer ${process.env.EXTERNAL_API_TOKEN}` // if needed
        },
        body: JSON.stringify({
          lead_numbers_id,
          message: content
        })
      }
    );

    const result = await response.json();
    console.log("📤 SMS API response:", result);

    return { success: true, result };
  } catch (error) {
    console.error("❌ Failed to send SMS:", error);
    return { success: false, error: error.message };
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