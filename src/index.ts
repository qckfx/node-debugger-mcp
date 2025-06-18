#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn, ChildProcess } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { inspect } from "util";
import { createConnection } from "net";
import CDP from "chrome-remote-interface";

interface ManagedProcess {
  pid: number;
  port: number;
  command: string;
  args: string[];
  process: ChildProcess;
  startTime: Date;
  scriptPath: string;
}

interface DebugSession {
  connected: boolean;
  processId?: number;
  port?: number;
  callStack?: any[];
  variables?: Record<string, any>;
  client?: any;
  breakpoints?: Map<string, string>;
  isPaused?: boolean;
  currentExecutionContext?: number;
}

class NodeDebuggerServer {
  private server: Server;
  private managedProcesses: Map<number, ManagedProcess> = new Map();
  private debugSession: DebugSession = { 
    connected: false,
    breakpoints: new Map(),
    isPaused: false
  };
  private nextPort = 9229;
  private usedPorts = new Set<number>();

  constructor() {
    this.server = new Server(
      {
        name: "debugger-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: "debug://session",
          mimeType: "application/json",
          name: "Debug Session State",
          description: "Current debugging session information",
        },
        {
          uri: "debug://processes",
          mimeType: "application/json", 
          name: "Managed Processes",
          description: "List of managed Node.js processes",
        },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      
      switch (uri) {
        case "debug://session":
          const sessionData = {
            connected: this.debugSession.connected,
            port: this.debugSession.port,
            isPaused: this.debugSession.isPaused,
            currentExecutionContext: this.debugSession.currentExecutionContext,
            breakpoints: Array.from(this.debugSession.breakpoints?.entries() || []),
            callStack: this.debugSession.callStack?.map(frame => ({
              functionName: frame.functionName,
              url: frame.url,
              lineNumber: frame.location.lineNumber + 1, // Convert back to 1-based
              columnNumber: frame.location.columnNumber,
              scopeChain: frame.scopeChain?.map((scope: any) => ({
                type: scope.type,
                name: scope.name
              }))
            }))
          };
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(sessionData, null, 2),
              },
            ],
          };
        
        case "debug://processes":
          const processes = Array.from(this.managedProcesses.values()).map(p => ({
            pid: p.pid,
            port: p.port,
            command: p.command,
            args: p.args,
            startTime: p.startTime,
            status: p.process.killed ? 'killed' : 'running'
          }));
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(processes, null, 2),
              },
            ],
          };
        
        default:
          throw new Error(`Unknown resource: ${uri}`);
      }
    });

    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "start_node_process",
          description: "Start a Node.js process with debugging enabled",
          inputSchema: {
            type: "object",
            properties: {
              script: { type: "string", description: "Path to the Node.js script to run" },
              args: { type: "array", items: { type: "string" }, description: "Arguments to pass to the script" },
              cwd: { type: "string", description: "Working directory (optional)" }
            },
            required: ["script"],
          },
        },
        {
          name: "kill_process",
          description: "Kill a managed Node.js process",
          inputSchema: {
            type: "object",
            properties: {
              pid: { type: "number", description: "Process ID to kill" }
            },
            required: ["pid"],
          },
        },
        {
          name: "list_processes",
          description: "List all managed Node.js processes",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "attach_debugger",
          description: "Attach debugger to a running Node.js process",
          inputSchema: {
            type: "object",
            properties: {
              port: { type: "number", description: "Debug port to connect to" }
            },
            required: ["port"],
          },
        },
        {
          name: "set_breakpoint",
          description: "Set a breakpoint in the debugged process. Use full file:// URLs for reliable breakpoint hits.",
          inputSchema: {
            type: "object",
            properties: {
              file: { 
                type: "string", 
                description: "File URL or path (use file:///absolute/path/to/file.js for best results)" 
              },
              line: { type: "number", description: "Line number (1-based)" },
              condition: { type: "string", description: "Optional condition for the breakpoint" }
            },
            required: ["file", "line"],
          },
        },
        {
          name: "step_debug",
          description: "Step through code execution",
          inputSchema: {
            type: "object",
            properties: {
              action: { 
                type: "string", 
                enum: ["next", "step", "continue", "out"],
                description: "Debug action to perform"
              }
            },
            required: ["action"],
          },
        },
        {
          name: "pause_execution",
          description: "Pause execution of the debugged process",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "evaluate_expression",
          description: "Evaluate an expression in the current debug context",
          inputSchema: {
            type: "object",
            properties: {
              expression: { type: "string", description: "Expression to evaluate" }
            },
            required: ["expression"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case "start_node_process":
          return await this.startNodeProcess(args as { script: string; args?: string[]; cwd?: string });
        
        case "kill_process":
          return await this.killProcess(args as { pid: number });
        
        case "list_processes":
          return await this.listProcesses();
        
        case "attach_debugger":
          return await this.attachDebugger(args as { port: number });
        
        case "set_breakpoint":
          return await this.setBreakpoint(args as { file: string; line: number; condition?: string });
        
        case "step_debug":
          return await this.stepDebug(args as { action: "next" | "step" | "continue" | "out" });
        
        case "pause_execution":
          return await this.pauseExecution();
        
        case "evaluate_expression":
          return await this.evaluateExpression(args as { expression: string });
        
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  private async startNodeProcess(args: { script: string; args?: string[]; cwd?: string }) {
    const workingDir = args.cwd || process.cwd();
    const scriptPath = resolve(workingDir, args.script);
    
    // Validate script exists
    if (!existsSync(scriptPath)) {
      return {
        content: [{
          type: "text",
          text: `Script not found: ${scriptPath}`,
        }],
        isError: true,
      };
    }
    
    // Find available port
    const port = await this.findAvailablePort();
    const nodeArgs = [`--inspect-brk=${port}`, args.script, ...(args.args || [])];
    
    try {
      const child = spawn("node", nodeArgs, {
        cwd: args.cwd || process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        detached: false,
      });

      if (!child.pid) {
        throw new Error("Failed to start process");
      }

      const managedProcess: ManagedProcess = {
        pid: child.pid,
        port,
        command: "node",
        args: nodeArgs,
        process: child,
        startTime: new Date(),
        scriptPath,
      };
      
      this.usedPorts.add(port);

      this.managedProcesses.set(child.pid, managedProcess);

      child.on("exit", (code) => {
        if (child.pid) {
          const process = this.managedProcesses.get(child.pid);
          if (process) {
            this.usedPorts.delete(process.port);
            this.managedProcesses.delete(child.pid);
            // Clean up debug session if it was connected to this process
            if (this.debugSession.port === process.port) {
              this.debugSession = { connected: false };
            }
          }
        }
      });

      return {
        content: [
          {
            type: "text",
            text: `Started Node.js process with PID ${child.pid} on debug port ${port}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error starting process: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async killProcess(args: { pid: number }) {
    const managedProcess = this.managedProcesses.get(args.pid);
    
    if (!managedProcess) {
      return {
        content: [
          {
            type: "text",
            text: `Process ${args.pid} not found in managed processes`,
          },
        ],
        isError: true,
      };
    }

    try {
      managedProcess.process.kill("SIGTERM");
      this.managedProcesses.delete(args.pid);
      
      return {
        content: [
          {
            type: "text",
            text: `Killed process ${args.pid}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error killing process: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async listProcesses() {
    const processes = Array.from(this.managedProcesses.values()).map(p => ({
      pid: p.pid,
      port: p.port,
      command: `${p.command} ${p.args.join(" ")}`,
      startTime: p.startTime.toISOString(),
      status: p.process.killed ? 'killed' : 'running'
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(processes, null, 2),
        },
      ],
    };
  }

  private async attachDebugger(args: { port: number }) {
    try {
      // Close existing connection if any
      if (this.debugSession.client) {
        await this.debugSession.client.close();
      }

      // Connect to the Node.js inspector using Chrome DevTools Protocol
      const client = await CDP({ port: args.port });
      
      const { Debugger, Runtime } = client;
      
      // Set up event handlers first
      Debugger.paused((params: any) => {
        this.debugSession.callStack = params.callFrames;
        this.debugSession.isPaused = true;
      });

      Debugger.resumed(() => {
        this.debugSession.isPaused = false;
        this.debugSession.callStack = [];
      });

      Runtime.executionContextCreated((params: any) => {
        this.debugSession.currentExecutionContext = params.context.id;
      });

      // Enable debugging domains
      await Debugger.enable();
      await Runtime.enable();

      // Initialize session
      this.debugSession = {
        connected: true,
        port: args.port,
        client,
        callStack: [],
        variables: {},
        breakpoints: new Map(),
        isPaused: false,
        currentExecutionContext: undefined
      };

      // For --inspect-brk, the runtime is waiting for debugger
      // We need to handle this special case
      try {
        // First, let's try to pause to ensure we're in a debuggable state
        await Debugger.pause();
        // Small delay for pause event
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        // Process might already be paused or not yet ready
      }

      // Now handle the waiting for debugger state
      try {
        // This will allow execution to continue from the initial --inspect-brk pause
        // But since we called pause() above, it should remain paused
        await Runtime.runIfWaitingForDebugger();
      } catch (error) {
        // If this fails, the process might not be waiting
      }

      // Small delay to allow all events to fire
      await new Promise(resolve => setTimeout(resolve, 200));

      return {
        content: [
          {
            type: "text",
            text: `Successfully attached debugger to port ${args.port}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error attaching debugger: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async setBreakpoint(args: { file: string; line: number; condition?: string }) {
    if (!this.debugSession.connected || !this.debugSession.client) {
      return {
        content: [
          {
            type: "text",
            text: "No active debug session. Please attach debugger first.",
          },
        ],
        isError: true,
      };
    }

    try {
      const { Debugger } = this.debugSession.client;
      
      // Use CDP to set the breakpoint
      const result = await Debugger.setBreakpointByUrl({
        lineNumber: args.line - 1, // CDP uses 0-based line numbers
        url: args.file,
        condition: args.condition
      });

      if (result.breakpointId) {
        // Store the breakpoint mapping
        const breakpointKey = `${args.file}:${args.line}`;
        this.debugSession.breakpoints!.set(breakpointKey, result.breakpointId);

        return {
          content: [
            {
              type: "text",
              text: `Set breakpoint at ${args.file}:${args.line}${args.condition ? ` (condition: ${args.condition})` : ""} - ID: ${result.breakpointId}`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: "text", 
              text: `Failed to set breakpoint at ${args.file}:${args.line}`,
            },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting breakpoint: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async stepDebug(args: { action: "next" | "step" | "continue" | "out" }) {
    if (!this.debugSession.connected || !this.debugSession.client) {
      return {
        content: [
          {
            type: "text",
            text: "No active debug session. Please attach debugger first.",
          },
        ],
        isError: true,
      };
    }

    try {
      const { Debugger } = this.debugSession.client;
      
      // Use CDP to perform the step action
      switch (args.action) {
        case "next":
          await Debugger.stepOver();
          break;
        case "step":
          await Debugger.stepInto();
          break;
        case "continue":
          await Debugger.resume();
          break;
        case "out":
          await Debugger.stepOut();
          break;
      }

      return {
        content: [
          {
            type: "text",
            text: `Performed debug action: ${args.action}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error performing debug action: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async pauseExecution() {
    if (!this.debugSession.connected || !this.debugSession.client) {
      return {
        content: [
          {
            type: "text",
            text: "No active debug session. Please attach debugger first.",
          },
        ],
        isError: true,
      };
    }

    try {
      const { Debugger } = this.debugSession.client;
      await Debugger.pause();

      return {
        content: [
          {
            type: "text",
            text: "Execution paused successfully",
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error pausing execution: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async evaluateExpression(args: { expression: string }) {
    if (!this.debugSession.connected || !this.debugSession.client) {
      return {
        content: [
          {
            type: "text",
            text: "No active debug session. Please attach debugger first.",
          },
        ],
        isError: true,
      };
    }

    try {
      const { Runtime, Debugger } = this.debugSession.client;
      
      let result;
      
      // If we're paused and have a call stack, evaluate in the current call frame
      if (this.debugSession.isPaused && this.debugSession.callStack && this.debugSession.callStack.length > 0) {
        const currentFrame = this.debugSession.callStack[0];
        result = await Debugger.evaluateOnCallFrame({
          callFrameId: currentFrame.callFrameId,
          expression: args.expression,
          returnByValue: true
        });
      } else {
        // Otherwise, evaluate in the runtime context
        result = await Runtime.evaluate({
          expression: args.expression,
          contextId: this.debugSession.currentExecutionContext,
          includeCommandLineAPI: true,
          returnByValue: true
        });
      }

      if (result.exceptionDetails) {
        return {
          content: [
            {
              type: "text",
              text: `Exception: ${result.exceptionDetails.exception?.description || 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }

      const value = result.result.value !== undefined 
        ? result.result.value 
        : result.result.description || '[Object]';

      return {
        content: [
          {
            type: "text",
            text: `${args.expression} = ${JSON.stringify(value, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error evaluating expression: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async findAvailablePort(): Promise<number> {
    let port = this.nextPort;
    while (this.usedPorts.has(port) || !(await this.isPortAvailable(port))) {
      port++;
    }
    this.nextPort = port + 1;
    return port;
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const connection = createConnection({ port }, () => {
        connection.end();
        resolve(false); // Port is in use
      });
      
      connection.on('error', () => {
        resolve(true); // Port is available
      });
    });
  }

  private cleanup() {
    // Close debug session if connected
    if (this.debugSession.client) {
      try {
        this.debugSession.client.close();
      } catch (error) {
        console.error('Error closing debug session:', error);
      }
    }

    // Kill all managed processes on shutdown
    for (const [pid, managedProcess] of this.managedProcesses) {
      try {
        managedProcess.process.kill('SIGTERM');
      } catch (error) {
        console.error(`Error killing process ${pid}:`, error);
      }
    }
    this.managedProcesses.clear();
    this.usedPorts.clear();
    this.debugSession = { 
      connected: false,
      breakpoints: new Map(),
      isPaused: false
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    
    // Setup cleanup on process exit
    process.on('SIGINT', () => {
      this.cleanup();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      this.cleanup();
      process.exit(0);
    });
    
    await this.server.connect(transport);
  }
}

const server = new NodeDebuggerServer();
server.run().catch(console.error);