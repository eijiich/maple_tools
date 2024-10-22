import React, { useState } from 'react';

interface AddTaskProps {
  onAddTask: (
    task: string, resetType?: 'daily' | 'weekly' | 'monthly',
    resetDay?: 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday',
    resetDayOfMonth?: number) => void;
}

const AddTask: React.FC<AddTaskProps> = ({ onAddTask }) => {
  const [task, setTask] = useState('');
  const [resetType, setResetType] = useState<'daily' | 'weekly' | 'monthly' | undefined>(undefined);
  const [resetDay, setResetDay] = useState<'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | undefined>(undefined);

  const handleSubmit = () => {
    if (task.trim()) {
      const resetDayOfMonth = resetType === 'monthly' ? 1 : undefined;
      onAddTask(task, resetType, resetDay, resetDayOfMonth);
      setTask('');  // Clear the input after adding
      setResetType(undefined);  // Clear resetType after adding
      setResetDay(undefined);  // Clear resetDay after adding
    }
  };

  return (
    <div className="mb-4 flex h-auto flex-col">
      <input
        className="border bg-gray-700 border-gray-500 rounded-lg p-2 flex-grow h-10 mb-2"
        type="text"
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder="Enter task"
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <label className="mr-2">Reset Type:</label>
          <select
            value={resetType || ''}
            onChange={(e) => setResetType(e.target.value === '' ? undefined : e.target.value as 'daily' | 'weekly' | 'monthly')}
            className="border bg-gray-700 border-gray-500 rounded-lg p-2"
          >
            <option value="">None</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>

        {resetType === 'weekly' && (
          <div className="flex items-center">
            <label className="mr-2">Reset Day:</label>
            <select
              value={resetDay || ''}
              onChange={(e) => setResetDay(e.target.value as 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday')}
              className="border bg-gray-700 border-gray-500 rounded-lg p-2"
            >
              <option value="sunday">Sunday</option>
              <option value="monday">Monday</option>
              <option value="tuesday">Tuesday</option>
              <option value="wednesday">Wednesday</option>
              <option value="thursday">Thursday</option>
              <option value="friday">Friday</option>
              <option value="saturday">Saturday</option>
            </select>
          </div>
        )}
      </div>
      <button
        className="mt-2 bg-gray-500 text-white p-2 rounded-lg"
        onClick={handleSubmit}
      >
        Add Task
      </button>
    </div>
  );
};

export default AddTask;
