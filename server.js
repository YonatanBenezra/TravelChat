require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');
const app = express();

app.use(express.json());

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Use your pre-created Assistant ID
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

// Process messages with the assistant
async function getAIResponse(message) {
  try {
    // Create a thread
    const thread = await openai.beta.threads.create();
    
    // Add the user message to the thread
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: message
    });
    
    // Run the assistant
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: ASSISTANT_ID
    });
    
    // Wait for the run to complete
    let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    
    while (runStatus.status !== 'completed') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      
      if (['failed', 'cancelled', 'expired'].includes(runStatus.status)) {
        throw new Error(`Assistant run ${runStatus.status}`);
      }
    }
    
    // Get the messages from the thread
    const messages = await openai.beta.threads.messages.list(thread.id);
    
    // Find the last assistant message
    const lastMessage = messages.data
      .filter(msg => msg.role === 'assistant')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    
    if (lastMessage && lastMessage.content[0].type === 'text') {
      return lastMessage.content[0].text.value;
    } else {
      return "I'm having trouble generating travel advice right now. Could you try rephrasing your question?";
    }
  } catch (error) {
    console.error("Error with OpenAI Assistant:", error);
    return "I'm having trouble connecting to my travel knowledge. Please try again shortly.";
  }
}

// Webhook verification endpoint for WhatsApp
app.get('/webhook', (req, res) => {
  const verify_token = process.env.VERIFY_TOKEN;
  
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  if (mode && token) {
    if (mode === 'subscribe' && token === verify_token) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// Receive messages endpoint for WhatsApp
app.post('/webhook', async (req, res) => {
  try {
    if (req.body.object && 
        req.body.entry && 
        req.body.entry[0].changes && 
        req.body.entry[0].changes[0].value.messages && 
        req.body.entry[0].changes[0].value.messages[0]) {
      
      const phoneNumberId = req.body.entry[0].changes[0].value.metadata.phone_number_id;
      const from = req.body.entry[0].changes[0].value.messages[0].from;
      const messageText = req.body.entry[0].changes[0].value.messages[0].text.body;
      
      console.log(`Received message: ${messageText} from ${from}`);
      
      // Get response from OpenAI Assistant
      const responseText = await getAIResponse(messageText);
      
      // Send the response
      await axios({
        method: 'POST',
        url: `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`,
        data: {
          messaging_product: 'whatsapp',
          to: from,
          text: { body: responseText }
        },
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      
      res.sendStatus(200);
    } else {
      res.sendStatus(400);
    }
  } catch (error) {
    console.error(`Error handling webhook:`, error);
    res.sendStatus(500);
  }
});

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).send('WhatsApp Travel Bot is running!');
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});