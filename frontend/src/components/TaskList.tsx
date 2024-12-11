import React from 'react';
import Task from './Task';

interface Todo {
  id?: number;
  task: string;
  completed: boolean;
  resetType?: 'daily' | 'weekly' | 'monthly';
  resetDay?: 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';
  resetDayOfMonth?: number;
  characterName?: string;  // New field for character name
  characterClass?: string; // New field for character class
}

interface TaskListProps {
  tasks: Todo[];  // Update this to reference the new Todo interface
  onToggleComplete: (id: number) => void;
  onRemoveTask: (id: number) => void;
}

const TaskList: React.FC<TaskListProps> = ({ tasks, onToggleComplete, onRemoveTask }) => {
  return (
    <ul className="mt-2">
      {tasks.map((task, index) => (
        <Task
          key={task.id ?? index}
          id={task.id ?? index}
          task={task.task}
          resetType={task.resetType}
          completed={task.completed}
          characterName={task.characterName}
          characterClass={task.characterClass}
          onToggleComplete={onToggleComplete}
          onRemoveTask={onRemoveTask}
        />
      ))}
    </ul>
  );
};

export default TaskList;