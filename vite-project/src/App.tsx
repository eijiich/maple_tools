import './App.css';
import { useRef } from 'react';
import TodoList from './components/TodoList';
import Sidebar from './components/Sidebar';

function App() {
  const todoListRef = useRef<any>(null);  // Create a ref to access the TodoList methods

  const refreshTodos = () => {
    if (todoListRef.current) {
      todoListRef.current.fetchTodos();  // Call fetchTodos from the TodoList
    }
  };

  return (
    <div className="App">
      <div className="text-left">
        <Sidebar fetchTodos={refreshTodos} />
      </div>
      <TodoList ref={todoListRef} /> {/* Pass the ref to TodoList */}
    </div>
  );
}

export default App;
