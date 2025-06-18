// Example Node.js application for testing the debugger  

function calculateSum(a, b) {
  const result = a + b;
  console.log(`Calculating ${a} + ${b} = ${result}`);
  return result;
}

function processNumbers() {
  const numbers = [1, 2, 3, 4, 5];
  let total = 0;
  
  for (let i = 0; i < numbers.length; i++) {
    console.log(`Processing number: ${numbers[i]}`);
    total = calculateSum(total, numbers[i]);
  }
  
  console.log(`Final total: ${total}`);
  return total;
}

function main() {
  console.log("Starting example application...");
  
  // Add a breakpoint opportunity here  
  debugger;
  
  const result = processNumbers();
  
  console.log("Application completed with result:", result);
  
  // Keep the process running for debugging
  setInterval(() => {
    console.log("Heartbeat...");
  }, 5000);
}

main();