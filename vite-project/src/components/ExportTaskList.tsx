import React from 'react';
import { getTodos } from '../utils/indexedDB';

const ExportTaskList: React.FC = () => {
  const exportTasks = async () => {
    const todos = await getTodos(); // Fetch tasks from indexedDB
    const json = JSON.stringify(todos, null, 2); // Convert tasks to JSON format
    await navigator.clipboard.writeText(json); // Copy to clipboard
    alert('Tasks copied to clipboard!');
  };

  return (
    <button
      onClick={exportTasks}
      className="bg-blue-700 text-white p-2 rounded-lg w-full mb-4"
    >
      Export Task List
    </button>
  );
};

export default ExportTaskList;
