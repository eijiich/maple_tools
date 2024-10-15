import React, { useState } from 'react';
import ConfirmationDialog from './ConfirmationDialog';

interface TaskProps {
  id: number;
  task: string;
  completed: boolean;
  onToggleComplete: (id: number) => void;
  onRemoveTask: (id: number) => void;
}

const Task: React.FC<TaskProps> = ({ id, task, completed, onToggleComplete, onRemoveTask }) => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleRemoveClick = () => {
    setIsDialogOpen(true);  // Open the confirmation dialog
  };

  const handleConfirmRemove = () => {
    onRemoveTask(id);  // Proceed with removal
    setIsDialogOpen(false);  // Close the dialog
  };

  return (
    <>
      <li className="flex bg-gray-800 justify-between items-center m-1 rounded-lg h-12">
        <div
          className="flex h-full items-center  w-full cursor-pointer"
          onClick={() => onToggleComplete(id)}
        >
          <input
            type="checkbox"
            checked={completed}
            onChange={() => onToggleComplete(id)}
            className="m-2 rounded cursor-pointer"
          />
          <span className={`flex-grow  ${completed ? 'line-through' : ''}`}>
            {task}
          </span>
        </div>
        <button className="ml-2 bg-red-950 text-red-400 m-1 p-2 rounded-lg" onClick={handleRemoveClick}>
          Remove
        </button>
      </li>
      <ConfirmationDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onConfirm={handleConfirmRemove}
      />
    </>
  );
};

export default Task;
