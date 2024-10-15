import React from 'react';

interface TaskProps {
  id: number;
  task: string;
  completed: boolean;
  onToggleComplete: (id: number) => void;
  onRemoveTask: (id: number) => void;
}

const Task: React.FC<TaskProps> = ({ id, task, completed, onToggleComplete, onRemoveTask }) => {
  return (
    <li className="flex justify-between items-center mb-2 pb-2">
      <div
        className="flex items-center w-full cursor-pointer"
        onClick={() => onToggleComplete(id)}
      >
        <input
          type="checkbox"
          checked={completed}
          onChange={() => onToggleComplete(id)}
          className="mr-2"
        />
        <span className={`flex-grow ${completed ? 'line-through' : ''}`}>
          {task}
        </span>
      </div>
      <button className="ml-4 text-red-500" onClick={() => onRemoveTask(id)}>
        Remove
      </button>
    </li>
  );
};

export default Task;
