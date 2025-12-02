import { Response } from 'express';
import { Listing } from '../types';

export class SSEBroadcaster {
  private clients: Map<number, Response>;
  private clientIdCounter: number;
  private history: Listing[] = [];
  private readonly MAX_HISTORY = 1000;

  constructor() {
    this.clients = new Map();
    this.clientIdCounter = 0;
  }

  public addClient(res: Response): number {
    const clientId = ++this.clientIdCounter;

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering in nginx

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`);

    // Send history
    if (this.history.length > 0) {
      console.log(`[SSE] Sending ${this.history.length} buffered listings to client ${clientId}`);
      this.history.forEach(listing => {
        res.write(`data: ${JSON.stringify({ type: 'listing', data: listing })}\n\n`);
      });
    }

    this.clients.set(clientId, res);
    console.log(`[SSE] Client ${clientId} connected (${this.clients.size} total)`);

    // Handle client disconnect
    res.on('close', () => {
      this.clients.delete(clientId);
      console.log(`[SSE] Client ${clientId} disconnected (${this.clients.size} remaining)`);
    });

    return clientId;
  }

  public broadcastListing(listing: Listing): void {
    // Add to history
    this.history.push(listing);
    if (this.history.length > this.MAX_HISTORY) {
      this.history.shift();
    }

    const data = JSON.stringify({ type: 'listing', data: listing });
    this.broadcast(data);
  }

  public broadcastMessage(type: string, data: any): void {
    const message = JSON.stringify({ type, data });
    this.broadcast(message);
  }

  private broadcast(data: string): void {
    const deadClients: number[] = [];

    this.clients.forEach((res, clientId) => {
      try {
        res.write(`data: ${data}\n\n`);
      } catch (error) {
        console.error(`[SSE] Error sending to client ${clientId}:`, error);
        deadClients.push(clientId);
      }
    });

    // Remove dead clients
    deadClients.forEach(clientId => {
      this.clients.delete(clientId);
    });
  }

  public getClientCount(): number {
    return this.clients.size;
  }

  public clearHistory(): void {
    this.history = [];
  }
}
