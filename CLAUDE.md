# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Debugger MCP** - a Model Context Protocol server that provides Node.js debugging capabilities for AI agents. It allows programmatic control of Node.js processes through debug sessions, breakpoints, and code evaluation.

## Development Commands

- `npm run build` - Compile TypeScript to build/ directory (required before first use)
- `npm run dev` - Run TypeScript compiler in watch mode for development  
- `npm start` - Run the compiled MCP server
- `npm run inspector` - Launch MCP inspector tool for debugging the server itself

## Architecture

### Core Structure
- **Single-file MCP server**: `src/index.ts` contains the complete NodeDebuggerServer implementation
- **ES Modules**: Project uses `"type": "module"` with ES2022 target
- **MCP Integration**: Implements the Model Context Protocol for AI agent interaction

### Key Components
- **NodeDebuggerServer class**: Main server with process management and debug tools
- **ManagedProcess interface**: Tracks spawned Node.js processes with debug ports
- **DebugSession interface**: Maintains debugging session state

### MCP Tools Provided
1. `start_node_process` - Launch Node.js scripts with `--inspect-brk` debugging (auto-pauses at start)
2. `kill_process` - Terminate managed processes  
3. `list_processes` - Show all managed processes
4. `attach_debugger` - Connect to debug port
5. `set_breakpoint` - Set breakpoints with optional conditions
   - **IMPORTANT**: Use full `file://` URLs for reliable breakpoints (e.g., `file:///absolute/path/to/file.js`)
6. `step_debug` - Step through execution (next, step, continue, out)
7. `pause_execution` - Manually pause a running process
8. `evaluate_expression` - Evaluate expressions in debug context

### MCP Resources
- `debug://session` - Current debug session state
- `debug://processes` - List of managed processes

## Testing

Use `example-app.js` for testing debugging features:
```bash
npm run build
node --inspect=9229 example-app.js
```

## Configuration

### MCP Setup
- `.mcp.json` - Pre-configured for project-local use
- Server must be built before first use: `npm run build`
- Debug ports auto-assigned starting from 9229

### Important Implementation Notes
- **Fully implemented** with Chrome DevTools Protocol via `chrome-remote-interface`
- Processes start with `--inspect-brk` to pause at first line, avoiding race conditions
- **Breakpoint URLs**: Must use full `file://` URLs for reliable breakpoint hits
- Automatically handles the "waiting for debugger" state with `Runtime.runIfWaitingForDebugger()`
- Full debugging capabilities: breakpoints, stepping, call stack, expression evaluation