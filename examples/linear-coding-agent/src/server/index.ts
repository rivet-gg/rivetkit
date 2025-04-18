import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import dotenv from 'dotenv';
import { createClient } from 'actor-core/client';
import { app } from '../actors/app';
import type { App } from '../actors/app';
import type { LinearWebhookEvent } from '../types';

// Load environment variables
dotenv.config();

// Create Hono app
const server = new Hono();
const PORT = process.env.PORT || 8080;

// Create actor client
const ACTOR_SERVER_URL = process.env.ACTOR_SERVER_URL || "http://localhost:6420";
const client = createClient<App>(ACTOR_SERVER_URL);

// Middleware to initialize agent
server.use('*', async (c, next) => {
  try {
    // Initialize any new actor instances with repository settings
    await next();
  } catch (error) {
    console.error('[SERVER] Error in middleware:', error);
    return c.json(
      { 
        status: 'error',
        statusEmoji: '❌', 
        message: error instanceof Error ? error.message : 'Unknown error' 
      }, 
      500
    );
  }
});

// Route for Linear webhooks
server.post('/api/webhook/linear', async (c) => {
  try {
    // Get raw payload for signature verification
    const rawBody = await c.req.text();
    
    // Verify webhook signature
    const signature = c.req.header('linear-signature');
    const webhookSecret = process.env.LINEAR_WEBHOOK_SECRET;
    
    if (webhookSecret) {
      // Only verify if webhook secret is configured
      const crypto = await import('crypto');
      const computedSignature = crypto.createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');
      
      if (signature !== computedSignature) {
        console.error('[SERVER] Invalid webhook signature');
        return c.json({ status: 'error', statusEmoji: '❌', message: 'Invalid webhook signature' }, 401);
      }
    } else {
      console.warn('[SERVER] LINEAR_WEBHOOK_SECRET not configured, skipping signature verification');
    }
    
    // Parse the webhook payload
    const event = JSON.parse(rawBody) as LinearWebhookEvent;
    
    console.log(`[SERVER] Received Linear webhook: ${event.type} - ${event.action}`);
    
    // Determine the issue ID to use as a tag for the actor
    const issueId = event.data.issue?.id ?? event.data.id;
    if (!issueId) {
      console.error('[SERVER] No issue ID found in webhook event');
      return c.json({ status: 'error', statusEmoji: '❌', message: 'No issue ID found in webhook event' }, 400);
    }
    
    // Create or get a coding agent instance with the issue ID as a tag
    // This ensures each issue gets its own actor instance
    console.log(`[SERVER] Getting actor for issue: ${issueId}`);
    const actorClient = await client.codingAgent.get({
      tags: { issueId },
    });
    
    // Initialize the agent if needed
    console.log(`[SERVER] Initializing actor for issue: ${issueId}`);
    await actorClient.initialize();
    
    // Determine which handler to use based on the event type and action
    if (event.type === 'Issue' && event.action === 'create') {
      // Handle new issue creation
      console.log(`[SERVER] Processing issue creation: ${issueId} - ${event.data.title}`);
      const result = await actorClient.issueCreated(event);
      return c.json({ 
        status: 'success', 
        message: result.message || 'Issue creation event queued for processing',
        requestId: result.requestId
      });
    } 
    else if (event.type === 'Comment' && event.action === 'create') {
      // Handle new comment with enhanced logging
      console.log(`[SERVER] Processing comment creation on issue: ${issueId}`);
      console.log(`[SERVER] Comment details: ID=${event.data.id}, Body="${event.data.body?.substring(0, 100)}${event.data.body && event.data.body.length > 100 ? '...' : ''}", UserIsBot=${event.data.user?.isBot}`);
      
      // Early detection of bot comments to avoid unnecessary processing
      if (event.data.user?.isBot) {
        console.log(`[SERVER] Skipping comment from bot user - preventing feedback loop`);
        return c.json({ 
          status: 'skipped', 
          message: 'Comment skipped - from bot user',
          statusEmoji: '⏭️'
        });
      }
      
      // Check for bot emojis at the start of comment
      if (event.data.body && (
          event.data.body.startsWith('✅') || 
          event.data.body.startsWith('❌') || 
          event.data.body.startsWith('🤖'))) {
        console.log(`[SERVER] Skipping comment with bot emoji: "${event.data.body?.substring(0, 20)}..."`);
        return c.json({ 
          status: 'skipped', 
          message: 'Comment skipped - contains bot emoji',
          statusEmoji: '⏭️'
        });
      }
      
      const result = await actorClient.commentCreated(event);
      console.log(`[SERVER] Comment sent to actor for processing, requestId: ${result.requestId}`);
      
      return c.json({ 
        status: 'success', 
        message: result.message || 'Comment creation event queued for processing',
        requestId: result.requestId 
      });
    }
    else if (event.type === 'Issue' && event.action === 'update') {
      // Handle issue updates (status changes)
      console.log(`[SERVER] Processing issue update: ${issueId} - New state: ${event.data.state?.name}`);
      const result = await actorClient.issueUpdated(event);
      return c.json({ 
        status: 'success', 
        message: result.message || 'Issue update event queued for processing',
        requestId: result.requestId
      });
    }
    else {
      // Unhandled event type
      console.log(`[SERVER] Unhandled event type: ${event.type} - ${event.action}`);
      return c.json({ status: 'skipped', statusEmoji: '⏭️', message: 'Event type not handled' });
    }
  } catch (error) {
    console.error('[SERVER] Error processing webhook:', error);
    return c.json(
      { 
        status: 'error',
        statusEmoji: '❌', 
        message: error instanceof Error ? error.message : 'Unknown error' 
      }, 
      500
    );
  }
});

// Health check endpoint
server.get('/health', (c) => {
  console.log('[SERVER] Health check requested');
  return c.json({ status: 'ok', statusEmoji: '✅', message: 'Service is healthy' });
});


// Start the server
console.log(`[SERVER] Starting server on port ${PORT}...`);
serve({
  fetch: server.fetch,
  port: Number(PORT),
}, (info) => {
  console.log(`[SERVER] Running on port ${info.port}`);
  console.log(`[SERVER] Linear webhook URL: http://localhost:${info.port}/api/webhook/linear`);
});
