import React, { useState } from 'react';

interface AddTaskProps {
  onAddTask: (task: string) => void;
}

const AddTask: React.FC<AddTaskProps> = ({ onAddTask }) => {
  const [newTask, setNewTask] = useState<string>('');

  const handleAddTask = () => {
    if (newTask.trim() === '') return;
    onAddTask(newTask);
    setNewTask('');
  };

  return (
    <div className="mb-4 flex">
      <input
        type="text"
        className="border border-gray-300 rounded-lg p-2 flex-grow"
        value={newTask}
        onChange={(e) => setNewTask(e.target.value)}
        placeholder="Enter a new task"
      />
      <button
        className="ml-2 bg-blue-500 text-white p-2 rounded-lg"
        onClick={handleAddTask}
      >
        Add Task
      </button>
    </div>
  );
};

export default AddTask;
