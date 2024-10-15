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
    <div className="mb-4 flex h-10">
      <input
        className="border bg-gray-700 border-gray-500 rounded-lg p-2 flex-grow h-10"
        type="text"
        value={task}
        onChange={(e) => setTask(e.target.value)}
      />
      <button
        className="ml-2 bg-gray-500 text-white p-2 rounded-lg"
        onClick={handleSubmit}
      >
        Add Task
      </button>
    </div>
  );
};

export default AddTask;
