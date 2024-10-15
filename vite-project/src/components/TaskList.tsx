import React from 'react';
import Task from './Task';

interface Todo {
  id?: number;
  task: string;
  completed: boolean;
}

interface TaskListProps {
  tasks: Todo[];
  onToggleComplete: (id: number) => void;
  onRemoveTask: (id: number) => void;
}

const TaskList: React.FC<TaskListProps> = ({ tasks, onToggleComplete, onRemoveTask }) => {
  return (
    <ul className="mt-2">
      {tasks.map((task, index) => (
        <Task
          key={task.id ?? index}  // Use index as fallback key if id is undefined
          id={task.id ?? index}    // Use index as fallback id if id is undefined
          task={task.task}
          completed={task.completed}
          onToggleComplete={onToggleComplete}
          onRemoveTask={onRemoveTask}
        />
      ))}
    </ul>
  );
};

export default TaskList;
