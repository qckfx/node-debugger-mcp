console.log('Starting test...');

function test() {
  console.log('Before breakpoint');
  const x = 1 + 2;  // Set breakpoint here
  console.log('After breakpoint, x =', x);
  return x;
}

// Call the function immediately
const result = test();
console.log('Result:', result);

// Keep process alive
setTimeout(() => {
  console.log('Done');
  process.exit(0);
}, 5000);