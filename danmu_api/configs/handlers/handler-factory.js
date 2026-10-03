import { NodeHandler } from './node-handler.js';
export class HandlerFactory {
  static async getHandler() { return new NodeHandler(); }
  static getSupportedPlatforms() { return ['node']; }
}
