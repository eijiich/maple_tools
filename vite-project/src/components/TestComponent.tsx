import React from 'react';

const TestComponent: React.FC = () => {
  return (
    <div className="p-4">
      <h1 className="text-3xl font-bold text-blue-600">Tailwind CSS is Working!</h1>
      <p className="mt-2 text-gray-700">
        If you see this styled text, then Tailwind CSS is correctly configured.
      </p>
      <button className="mt-4 bg-green-500 text-white px-4 py-2 rounded">
        Test Button
      </button>
    </div>
  );
};

export default TestComponent;
