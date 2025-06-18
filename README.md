# Node.js Debugger MCP Server

An MCP server that provides Node.js debugging capabilities with process management for AI agents.

## Features

- **Process Management**: Start/stop Node.js processes with debugging enabled
- **Debugging Tools**: Set breakpoints, step through code, evaluate expressions
- **Inspector Integration**: Connect to Node.js Inspector API
- **AI Agent Friendly**: Designed for long-running debugging sessions

## Installation

1. Build the server:
   ```bash
   npm install
   npm run build
   ```

2. **For Project-Specific Use**: The `.mcp.json` file is already configured in this project

3. **For User-Wide Use**: Add to your global Claude Code configuration:
   ```bash
   claude mcp add --scope user debugger-mcp node /absolute/path/to/debugger-mcp/build/index.js
   ```

4. **For Global Use**: Copy the `.mcp.json` to your projects or add to global config

## Usage with Claude Code

Once configured, you'll have access to these tools in Claude Code:

### Process Management
- `start_node_process` - Launch Node.js scripts with debugging
- `kill_process` - Terminate processes by PID
- `list_processes` - Show all managed processes

### Debugging
- `attach_debugger` - Connect to debug port
- `set_breakpoint` - Set breakpoints with optional conditions
  - **Important**: Use full `file://` URLs for reliable breakpoint hits
  - Example: `file:///Users/you/project/script.js`
- `step_debug` - Step through code (next/step/continue/out)
- `pause_execution` - Manually pause a running process
- `evaluate_expression` - Evaluate expressions in debug context

### Resources
- `debug://session` - Current debug session state
- `debug://processes` - List of managed processes

## Example Usage

1. Start a Node.js process:
   ```
   Use the start_node_process tool with script: "example-app.js"
   ```

2. Attach debugger:
   ```
   Use attach_debugger tool with the port returned from step 1
   ```

3. Set breakpoints and debug:
   ```
   # Set a breakpoint using full file URL
   Use set_breakpoint tool with:
   - file: "file:///absolute/path/to/example-app.js"
   - line: 5
   
   # Control execution
   Use step_debug tool with action: "continue"
   ```

## Key Features

- **Automatic Pause on Start**: Uses `--inspect-brk` flag to pause at first line
- **Full Chrome DevTools Protocol**: Real debugging, not simulation
- **Reliable Breakpoints**: Use `file://` URLs for consistent breakpoint hits
- **Process Management**: Track and manage multiple debugging sessions

## Testing

Test with the included example app:
```bash
node --inspect=9229 example-app.js
```

Then use the MCP tools to debug it!

## Debug the MCP Server

```bash
npm run inspector
```