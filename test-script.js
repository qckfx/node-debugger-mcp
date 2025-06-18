console.log("Test script starting...");

function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

console.log("Computing fibonacci(10)...");
const result = fibonacci(10);
console.log("Result:", result);

setInterval(() => {
  console.log("Heartbeat at", new Date().toISOString());
}, 2000);