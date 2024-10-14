import React from 'react';
import Task from './Task';

interface TaskListProps {
  tasks: { text: string; completed: boolean }[];
  onToggleTask: (index: number) => void;
  onRemoveTask: (index: number) => void;
}

const TaskList: React.FC<TaskListProps> = ({ tasks, onToggleTask, onRemoveTask }) => {
  return (
    <ul className="list-none p-0">
      {tasks.map((task, index) => (
        <Task
          key={index}
          text={task.text}
          completed={task.completed}
          onToggle={() => onToggleTask(index)}
          onRemove={() => onRemoveTask(index)}
        />
      ))}
    </ul>
  );
};

export default TaskList;
