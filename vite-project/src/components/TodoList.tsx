import React, { useState, useEffect } from 'react';
import { addTodo, getTodos, removeTodo, updateTodo } from '../utils/indexedDB';
import AddTask from './AddTask';
import TaskList from './TaskList';

interface Todo {
  id?: number;
  task: string;
  completed: boolean;
}

const TodoList: React.FC = () => {
  const [todos, setTodos] = useState<Todo[]>([]);  // State is Todo[]

  useEffect(() => {
    const fetchTodos = async () => {
      const storedTodos: Todo[] = await getTodos();  // Ensure getTodos returns Todo[]
      setTodos(storedTodos);  // Pass the array directly
    };
    fetchTodos();
  }, []);

  const handleAddTask = async (task: string) => {
    await addTodo(task);
    const updatedTodos: Todo[] = await getTodos();  // Fetch updated todos
    setTodos(updatedTodos);  // Set state to updated list of todos
  };

  const handleRemoveTask = async (id: number) => {
    await removeTodo(id);
    const updatedTodos: Todo[] = await getTodos();
    setTodos(updatedTodos);
  };

  const handleToggle = async (id: number) => {
    const todo = todos.find((t) => t.id === id);
    if (todo) {
      await updateTodo({ ...todo, completed: !todo.completed });
      const updatedTodos: Todo[] = await getTodos();
      setTodos(updatedTodos);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-10 p-4 rounded-lg">
      <h1 className="text-2xl font-bold mb-4">To-Do List</h1>
      <AddTask onAddTask={handleAddTask} />
      <TaskList
        tasks={todos}
        onToggleComplete={handleToggle}
        onRemoveTask={handleRemoveTask}
      />
    </div>
  );
};

export default TodoList;
