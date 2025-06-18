function testVariables() {
  const a = 5;
  const b = 10;
  const sum = a + b;  // Set breakpoint here at line 4
  console.log('Sum is:', sum);
  return sum;
}

console.log('Starting variable test...');
const result = testVariables();
console.log('Final result:', result);

// Keep alive
setTimeout(() => process.exit(0), 2000);