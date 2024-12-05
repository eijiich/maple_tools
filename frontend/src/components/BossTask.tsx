import React, { useState } from 'react';
import ConfirmationDialog from './ConfirmationDialog';

interface BossTaskProps {
  id: number;
  task: string;
  completed: boolean;
  characterName?: string;
  characterClass?: string;
  bossName: string;
  partySize: number;
  onToggleComplete: (id: number) => void;
  onRemoveTask: (id: number) => void;
  onUpdatePartySize: (id: number, partySize: number) => void; // Callback for party size updates
}


const BossTask: React.FC<BossTaskProps> = ({
  id,
  task,
  completed,
  bossName,
  characterName,
  characterClass,
  partySize,
  onToggleComplete,
  onRemoveTask,
  onUpdatePartySize,
}) => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [currentPartySize, setCurrentPartySize] = useState<number | ''>(partySize); // Track current party size
  const handleRemoveClick = () => {
    setIsDialogOpen(true); // Open the confirmation dialog
  };

  const handleConfirmRemove = () => {
    onRemoveTask(id); // Proceed with removal
    setIsDialogOpen(false); // Close the dialog
  };

  const handlePartySizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPartySize = e.target.value ? Number(e.target.value) : '';
    setCurrentPartySize(newPartySize);
    if (newPartySize !== '') {
      onUpdatePartySize(id, newPartySize); // Notify parent of the change
    }
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
        <input
          type="number"
          value={currentPartySize}
          onChange={handlePartySizeChange}
          placeholder="Party Size"
          className="text-center max-w-12 m-2 rounded border"
        />
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
      Boss: <strong>{bossName}</strong> | Character: <strong>{characterName}</strong> | Class: <strong>{characterClass}</strong>
      </div>
    </>
  );
};

export default BossTask;