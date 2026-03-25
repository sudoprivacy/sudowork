fetch('https://jsonplaceholder.typicode.com/todos/1')
  .then((res) => res.json())
  .then((data) => console.log('data:', data))
  .catch((err) => console.log('error:', err));
