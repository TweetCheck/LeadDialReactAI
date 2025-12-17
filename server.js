import express from 'express';
import { runWorkflow } from './index.js';

const app = express();
app.use(express.json());

// ✅ async handler
app.post('/lead-details', async (req, res) => {
  try {
    const leadData = req.body;

     const {
      lead_id,
      from_zip,
      to_zip,
      move_size_id,
      move_date,
      sms_content
    } = req.body;

    const input_as_text = `${sms_content} from ${from_zip} to ${to_zip} lead_id ${lead_id} move_size: ${move_size_id} move_date: ${move_date}`;
    //console.log('Workflow input:', input_as_text);
    //console.log('Lead received:', leadData);

    const result = await runWorkflow({
      input_as_text
    });

    res.status(200).json({
      success: true,
      message: 'Lead details received successfully',
      data: leadData,
      sdk_result: result
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start Node server
app.listen(5000, '127.0.0.1', () => {
  console.log('Node API running at http://127.0.0.1:5000');
});
