import React, { useState } from 'react';

function TodoItem({ todo, updateTodo, deleteTodo }) {
  const [isEditing, setIsEditing] = useState(false);
  const [task, setTask] = useState(todo.task);

  const handleUpdate = () => {
    updateTodo(todo.id, { task, completed: todo.completed });
    setIsEditing(false);
  };

  return (
    <li>
      {isEditing ? (
        <div>
          <input
            type="text"
            value={task}
            onChange={(e) => setTask(e.target.value)}
          />
          <button onClick={handleUpdate}>Save</button>
          <button onClick={() => setIsEditing(false)}>Cancel</button>
        </div>
      ) : (
        <div>
          <span style={{ textDecoration: todo.completed ? 'line-through' : 'none' }}>
            {todo.task}
          </span>
          <button onClick={() => setIsEditing(true)}>Edit</button>
          <button onClick={() => updateTodo(todo.id, { ...todo, completed: !todo.completed })}>
            {todo.completed ? 'Undo' : 'Complete'}
          </button>
          <button onClick={() => deleteTodo(todo.id)}>Delete</button>
        </div>
      )}
    </li>
  );
}

export default TodoItem;
