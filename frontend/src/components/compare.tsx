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
  characterName?: string;
  characterClass?: string;
  bossName?: string;
  partySize?: number;
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
    <div className="flex">
      <div className="w-1/2"> {/* Left Column for General Tasks */}
        <h1 className="text-2xl font-bold mb-4">General Todo List</h1>
        <AddTask onAddTask={handleAddTask} />
        <TaskList tasks={generalTasks} onToggleComplete={handleToggle} onRemoveTask={handleRemoveTask} />
      </div>
      <div className="w-1/2"> {/* Right Column for Boss Tasks */}
        <h1 className="text-2xl font-bold mb-4">Boss Task List</h1>
        <BossTaskList tasks={bossTasks} onToggleComplete={handleToggle} onRemoveTask={handleRemoveTask} />
      </div>
    </div>
  );
});

export default TodoList;