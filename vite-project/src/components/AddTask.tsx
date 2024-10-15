import React, { useState } from 'react';

interface AddTaskProps {
  onAddTask: (task: string) => void;
}

const AddTask: React.FC<AddTaskProps> = ({ onAddTask }) => {
  const [task, setTask] = useState('');

  const handleSubmit = () => {
    if (task.trim()) {
      onAddTask(task);
      setTask('');  // Clear the input after adding
    }
  };

  return (
    <div className="mb-4 flex">
      <input
        className="border border-gray-300 rounded-lg p-2 flex-grow"
        type="text"
        value={task}
        onChange={(e) => setTask(e.target.value)}
      />
      <button
        className="ml-2 bg-blue-500 text-white p-2 rounded-lg"
        onClick={handleSubmit}
      >
        Add Task
      </button>
    </div>
  );
};

export default AddTask;
