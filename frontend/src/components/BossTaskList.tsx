import React from 'react';
import BossTask from './BossTask';

interface Todo {
  id?: number;
  task: string;
  completed: boolean;
  resetType?: 'daily' | 'weekly' | 'monthly';
  resetDay?: 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';
  resetDayOfMonth?: number;
  characterName?: string;
  characterClass?: string;
  bossName: string;
  partySize: number;
}

interface BossTaskListProps {
  tasks: Todo[]; // Array of tasks that are boss-related
  onToggleComplete: (id: number) => void; // Function for toggling completion status
  onRemoveTask: (id: number) => void; // Function for removing a task
  onUpdatePartySize: (id: number, partySize: number) => void; // Function for updating party size
}

const BossTaskList: React.FC<BossTaskListProps> = ({
  tasks,
  onToggleComplete,
  onRemoveTask,
  onUpdatePartySize,
}) => {
  return (
    <ul className="mt-2">
      {tasks.map((task, index) => (
        <BossTask
          key={task.id ?? index}
          id={task.id ?? index}
          task={task.task}
          completed={task.completed}
          characterName={task.characterName}
          characterClass={task.characterClass}
          bossName={task.bossName}
          partySize={task.partySize}
          onToggleComplete={onToggleComplete}
          onRemoveTask={onRemoveTask}
          onUpdatePartySize={onUpdatePartySize} // Pass the callback here
        />
      ))}
    </ul>
  );
};

export default BossTaskList;