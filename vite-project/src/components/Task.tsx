import React from 'react';

interface TaskProps {
  text: string;
  completed: boolean;
  onToggle: () => void;
  onRemove: () => void;
}

const Task: React.FC<TaskProps> = ({ text, completed, onToggle, onRemove }) => {
  return (
    <li className="flex justify-between items-center mb-2 border-b pb-2">
      <div className="flex items-center w-full">
        <input
          type="checkbox"
          checked={completed}
          onChange={onToggle}
          className="mr-2"
        />
        <span className={`flex-grow ${completed ? 'line-through' : ''}`}>
          {text}
        </span>
      </div>
      <button className="text-red-500 ml-4" onClick={onRemove}>
        Remove
      </button>
    </li>
  );
};

export default Task;
