import React, { useState } from 'react';
import ConfirmationDialog from './ConfirmationDialog';

interface TaskProps {
  id: number;
  task: string;
  completed: boolean;
  characterName?: string;  // New field for character name
  characterClass?: string; // New field for character class
  onToggleComplete: (id: number) => void;
  onRemoveTask: (id: number) => void;
}

const Task: React.FC<TaskProps> = ({
  id,
  task,
  completed,
  characterName,
  characterClass,
  onToggleComplete,
  onRemoveTask,
}) => {
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
          className="flex h-full items-center w-full cursor-pointer"
          onClick={() => onToggleComplete(id)}
        >
          <input
            type="checkbox"
            checked={completed}
            onChange={() => onToggleComplete(id)}
            className="m-2 rounded cursor-pointer"
          />
          <span className={`flex-grow ${completed ? 'line-through' : ''}`}>
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
      {/* Display the character name and class below the task */}
      <div className="ml-4 text-gray-400 text-sm">
        Character: <strong>{characterName}</strong> | Class: <strong>{characterClass}</strong>
      </div>
    </>
  );
};

export default Task;