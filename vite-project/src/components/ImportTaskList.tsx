import React, { useState } from 'react';
import { addTodo, getTodos, removeTodo } from '../utils/indexedDB';

interface ImportTaskListProps {
  fetchTodos: () => void;  // Function to refresh the task list
}

const ImportTaskList: React.FC<ImportTaskListProps> = ({ fetchTodos }) => {
  const [jsonInput, setJsonInput] = useState<string>('');

  const importTasks = async () => {
    try {
      const tasks = JSON.parse(jsonInput); // Parse the JSON input

      if (!Array.isArray(tasks)) {
        throw new Error('Invalid format');
      }

      // Clear existing tasks in indexedDB
      const currentTodos = await getTodos();
      for (const todo of currentTodos) {
        await removeTodo(todo.id!);
      }

      // Add new tasks
      for (const task of tasks) {
        if (task.task && typeof task.task === 'string') {
          await addTodo(task.task);
        }
      }

      alert('Tasks imported successfully!');
      fetchTodos();  // Refresh the task list after importing
    } catch (error) {
      alert('Invalid JSON format');
    }
  };

  return (
    <div>
      <textarea
        value={jsonInput}
        onChange={(e) => setJsonInput(e.target.value)}
        className="border border-gray-300 rounded-lg p-2 w-full mb-2"
        placeholder="Paste JSON here"
        rows={5}
      />
      <button
        onClick={importTasks}
        className="bg-green-500 text-white p-2 rounded-lg w-full"
      >
        Import Task List
      </button>
    </div>
  );
};

export default ImportTaskList;
