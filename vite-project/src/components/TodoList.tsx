import { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { addTodo, getTodos, removeTodo, updateTodo } from '../utils/indexedDB';
import AddTask from './AddTask';
import TaskList from './TaskList';

interface Todo {
  id?: number;
  task: string;
  completed: boolean;
}

const TodoList = forwardRef((_props, ref) => {
  const [todos, setTodos] = useState<Todo[]>([]);

  const fetchTodos = async () => {
    const storedTodos: Todo[] = await getTodos();
    setTodos(storedTodos);
  };

  useEffect(() => {
    fetchTodos();
  }, []);

  useImperativeHandle(ref, () => ({
    fetchTodos,  // Expose fetchTodos method to parent component
  }));

  const handleAddTask = async (task: string) => {
    await addTodo(task);
    fetchTodos();
  };

  const handleRemoveTask = async (id: number) => {
    await removeTodo(id);
    fetchTodos();
  };

  const handleToggle = async (id: number) => {
    const todo = todos.find((t) => t.id === id);
    if (todo) {
      await updateTodo({ ...todo, completed: !todo.completed });
      fetchTodos();
    }
  };

  return (
    <div className="max-w-md mx-auto mt-4 p-4 rounded-lg">
      <h1 className="text-2xl font-bold mb-4">To-Do List</h1>
      <AddTask onAddTask={handleAddTask} />
      <TaskList
        tasks={todos}
        onToggleComplete={handleToggle}
        onRemoveTask={handleRemoveTask}
      />
    </div>
  );
});

export default TodoList;
