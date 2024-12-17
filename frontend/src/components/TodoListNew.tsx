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
  bossName?: string;
  partySize?: number;
}

const TodoList = forwardRef((_props, ref) => {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [isAddTaskVisible, setAddTaskVisible] = useState(false);

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
    bossName?: string,
    partySize?: number
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

  const handleUpdatePartySize = async (id: number, partySize: number) => {
    const todo = todos.find((t) => t.id === id);
    if (todo) {
      const updatedTodo = { ...todo, partySize };
      await updateTodo(updatedTodo); // Update in IndexedDB
      setTodos((prevTodos) =>
        prevTodos.map((t) => (t.id === id ? updatedTodo : t)) // Update in state
      );
    }
  };

  const generalTasks = todos.filter(todo => !todo.bossName);
  const bossTasks = todos.filter(todo => todo.bossName) as (Todo & { bossName: string; partySize: number; })[];

  const toggleAddTask = () => {
    setAddTaskVisible((prev) => !prev);
  };

  return (
    <div>
      <div className="max-w-md mx-auto mt-4 p-4 rounded-lg">
        <h1 className="text-4xl font-bold mb-4">Maple Planner</h1>
      </div>
      {/* <div className="flex justify-evenly mt-4 p-4"> */}
      <div className="flex flex-col md:flex-row items-center md:items-start content-center justify-center space-y-8 md:space-y-0 md:space-x-16">
        <div className="max-w-md w-full">
          <h1 className="text-4xl font-bold mb-4 flex justify-between items-center">
            General Content
            <button
              onClick={toggleAddTask}
              className="ml-4 bg-blue-500 text-white rounded px-4 py-2"
            >
              {isAddTaskVisible ? 'Hide Add Task' : 'Add Task'}
              
            </button>
          </h1>
          {isAddTaskVisible && (
            <div className="bg-gray-800 p-4 rounded-lg mb-4">
              <h2 className="text-2xl font-bold mb-4">Add Task</h2>
              <AddTask onAddTask={handleAddTask} />
            </div>
          )}
          
          <TaskList
            tasks={generalTasks}
            onToggleComplete={handleToggle}
            onRemoveTask={handleRemoveTask}
          />
        </div>
        <div className="max-w-md w-full">
          <h1 className="text-4xl font-bold mb-4">Boss Content</h1>
          <BossTaskList
            tasks={bossTasks}
            onToggleComplete={handleToggle}
            onRemoveTask={handleRemoveTask}
            onUpdatePartySize={handleUpdatePartySize}
          />
        </div>
      </div>
      {/* <div className="max-w-md mx-auto mt-4 p-4 rounded-lg">
        <h2 className="text-2xl font-bold mb-4">Add Task</h2>
        <AddTask onAddTask={handleAddTask} />
      </div> */}
    </div>
  );
});

export default TodoList;