import { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { addTodo, getTodos, removeTodo, updateTodo } from '../utils/indexedDB';
import AddTask from './AddTask';
import TaskList from './TaskList';
import BossTaskList from './BossTaskList';

interface Todo {
  id?: number;
  task: string;
  completed: boolean;
  resetType?: 'daily' | 'weekly' | 'monthly';
  resetDay?: 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';
  resetDayOfMonth?: number;
  lastReset?: string;
  characterName?: string;
  characterClass?: string;
  bossName?: string; // Optional for boss task
  partySize?: number; // Current party size for boss task
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
    fetchTodos,
  }));

  const handleAddTask = async (
    task: string,
    characterName?: string,
    characterClass?: string,
    resetType?: 'daily' | 'weekly' | 'monthly',
    resetDay?: Todo['resetDay'],
    resetDayOfMonth?: number,
    bossName?: string, // New field for boss name
    partySize?: number // New field for party size
  ) => {
    await addTodo(task, characterName, characterClass, resetType, resetDay, resetDayOfMonth, bossName, partySize);
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

  const generalTasks = todos.filter(todo => !todo.bossName); // Filter out general tasks
  const bossTasks = todos.filter(todo => todo.bossName) as (Todo & { bossName: string; partySize: number; })[];

  return (
    <div>
      <div className="max-w-md mx-auto mt-4 p-4 rounded-lg">
        <h1 className="text-4xl font-bold mb-4">Maple Planner</h1>
      </div>
      {/* <div className="flex justify-evenly mt-4 p-4"> */}
      <div className="flex flex-col md:flex-row items-center justify-center space-y-8 md:space-y-0 md:space-x-16">
        <div className="flex-grow max-w-md w-full">
          <h1 className="text-4xl font-bold mb-4">General Content</h1>
          <TaskList
            tasks={generalTasks}
            onToggleComplete={handleToggle}
            onRemoveTask={handleRemoveTask}
          />
        </div>
        <div className="flex-grow max-w-md w-full">
          <h1 className="text-4xl font-bold mb-4">Boss Content</h1>
          <BossTaskList
            tasks={bossTasks}
            onToggleComplete={handleToggle}
            onRemoveTask={handleRemoveTask}
          />
        </div>
      </div>
      <div className="max-w-md mx-auto mt-4 p-4 rounded-lg">
        <h2 className="text-2xl font-bold mb-4">Add Task</h2>
        <AddTask onAddTask={handleAddTask} />
      </div>
    </div>
  );
});

export default TodoList;