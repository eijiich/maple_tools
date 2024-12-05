import React, { useState } from 'react';
import { addTodo, getTodos, removeTodo } from '../utils/indexedDB';

interface ImportTaskListProps {
  fetchTodos: () => void;  // Function to refresh the task list
}

const ImportTaskList: React.FC<ImportTaskListProps> = ({ fetchTodos }) => {
  const [jsonInput, setJsonInput] = useState<string>('');

  const importTasks = async () => {
    try {
      const tasks = JSON.parse(jsonInput);

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
        // Validate required fields: task, characterName, characterClass
        if (task.task && typeof task.task === 'string' &&
            task.characterName && typeof task.characterName === 'string' &&
            task.characterClass && typeof task.characterClass === 'string') {
              
          // Add optional fields if they exist
          const { bossName, partySize, resetType, resetDay, resetDayOfMonth } = task;
          await addTodo(task.task, task.characterName, task.characterClass, resetType, resetDay, resetDayOfMonth, bossName, partySize);
        } else {
          alert('Invalid task format. Make sure to include task, characterName, and characterClass.');
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
        className="border bg-gray-700 border-gray-500 rounded-lg p-2 w-full mb-2"
        placeholder="Paste JSON here"
        rows={5}
      />
      <button
        onClick={importTasks}
        className="bg-green-700 text-white p-2 rounded-lg w-full"
      >
        Import Task List
      </button>
    </div>
  );
};

export default ImportTaskList;