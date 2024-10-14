import { useState, useEffect } from 'react';
import AddTask from './AddTask';
import TaskList from './TaskList';

interface Task {
  text: string;
  completed: boolean;
}

function TodoList() {
  const [tasks, setTasks] = useState<Task[]>([]);

  // Load tasks from LocalStorage
  useEffect(() => {
    const storedTasks = localStorage.getItem('tasks');
    if (storedTasks) {
      setTasks(JSON.parse(storedTasks));
    }
  }, []);

  // Save tasks to LocalStorage whenever tasks array changes
  useEffect(() => {
    if (tasks.length > 0) {
      localStorage.setItem('tasks', JSON.stringify(tasks));
    }
  }, [tasks]);

  const addTask = (taskText: string) => {
    setTasks([...tasks, { text: taskText, completed: false }]);
  };

  const toggleTask = (index: number) => {
    const updatedTasks = tasks.map((task, i) => (
      i === index ? { ...task, completed: !task.completed } : task
    ));
    setTasks(updatedTasks);
  };

  const removeTask = (index: number) => {
    const updatedTasks = tasks.filter((_, i) => i !== index);
    setTasks(updatedTasks);
  };

  return (
    <div className="max-w-md mx-auto mt-10 p-4 bg-white rounded-lg shadow-lg">
      <h1 className="text-2xl font-bold mb-4">To-Do List</h1>
      <AddTask onAddTask={addTask} />
      <TaskList 
        tasks={tasks} 
        onToggleTask={toggleTask} 
        onRemoveTask={removeTask} 
      />
    </div>
  );
}

export default TodoList;
