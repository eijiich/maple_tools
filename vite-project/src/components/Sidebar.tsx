import React, { useState } from 'react';
import ImportTaskList from './ImportTaskList';
import ExportTaskList from './ExportTaskList';

interface SidebarProps {
  fetchTodos: () => void;  // Pass the function to refresh the task list
}

const Sidebar: React.FC<SidebarProps> = ({ fetchTodos }) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleSidebar = () => {
    setIsOpen(!isOpen);
  };

  return (
    <div className="relative">
      <button
        className="text-xl focus:outline-none"
        onClick={toggleSidebar}
      >
        &#9776; {/* Hamburger menu icon */}
      </button>

      <div
        className={`fixed left-0 top-0 w-64 bg-gray-800 text-white h-full transition-transform transform ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="p-4 ">
          <button className="text-xl mb-4" onClick={toggleSidebar}>
            &#x2715; {/* Close icon */}
          </button>
          <ExportTaskList />
          <ImportTaskList fetchTodos={fetchTodos} />
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
