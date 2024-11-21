import { openDB, DBSchema } from 'idb';

interface Todo {
  id?: number;  // id is optional when adding a new todo
  task: string;
  completed: boolean;
  resetType?: 'daily' | 'weekly' | 'monthly';  // Optional reset type
  resetDay?: 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';  // For weekly tasks
  resetDayOfMonth?: number;  // For monthly tasks
  lastReset?: string;  // ISO string for the last time the task was reset
  characterName?: string;  // New field for character name
  characterClass?: string;  // New field for character class
  bossName?: string; // New field for boss name
  partySize?: number; // New field for party size
}

interface MyDB extends DBSchema {
  todos: {
    key: number;
    value: Todo;
  };
}

const dbPromise = openDB<MyDB>('todo-db', 1, {
  upgrade(db) {
    db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true });
  },
});

// Add a new todo with optional reset schedule
export const addTodo = async (
  task: string,
  characterName?: string,
  characterClass?: string,
  resetType?: 'daily' | 'weekly' | 'monthly',
  resetDay?: Todo['resetDay'],
  resetDayOfMonth?: number,
  bossName?: string, // New field for boss name
  partySize?: number // New field for party size
) => {
  const db = await dbPromise;
  const lastReset = new Date().toISOString(); // Record current time as the last reset time

  await db.add('todos', {
    task,
    completed: false,
    resetType,
    resetDay,
    resetDayOfMonth,
    lastReset,
    characterName,
    characterClass,
    bossName, // Include new fields
    partySize, // Include new fields
  });
};

export const getTodos = async (): Promise<Todo[]> => {
  const db = await dbPromise;   
  return await db.getAll('todos');  // Returns Todo[]
};

export const removeTodo = async (id: number) => {
  const db = await dbPromise;
  await db.delete('todos', id);
};

export const updateTodo = async (todo: Todo) => {
  const db = await dbPromise;
  await db.put('todos', todo);
};

// Function to determine if a todo should reset based on the reset type and current time
function shouldResetTask(todo: Todo): boolean {
  const now = new Date();
  const lastReset = todo.lastReset ? new Date(todo.lastReset) : null;

  if (!lastReset) return false;

  const resetTime = new Date(lastReset); // Start with the last reset time

  if (todo.resetType === 'daily') {
    resetTime.setHours(21, 0, 0, 0); // Set to 9 PM today
    // If current time is after 9 PM, set reset time to 9 PM tomorrow
    if (now < lastReset && now > resetTime) {
      resetTime.setDate(resetTime.getDate() + 1);
    }
    return now >= resetTime;

  } else if (todo.resetType === 'weekly' && todo.resetDay) {
    const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const resetDayIndex = daysOfWeek.indexOf(todo.resetDay.toLowerCase());
    const nowDayIndex = now.getDay();

    // Set the reset time to 9 PM on the next reset day
    if (resetDayIndex >= 0) {
      resetTime.setDate(now.getDate() + (resetDayIndex - nowDayIndex + 7) % 7);  // Get the next reset day
      resetTime.setHours(21, 0, 0, 0); // Set to 9 PM on the reset day
      // If today is the reset day and it's after 9 PM, set to next week's reset day
      if (nowDayIndex === resetDayIndex && (now < lastReset && now > resetTime)) {
        resetTime.setDate(resetTime.getDate() + 7);
      }
      return now >= resetTime;
    }

  } else if (todo.resetType === 'monthly' && todo.resetDayOfMonth) {
    resetTime.setDate(todo.resetDayOfMonth); // Set to the reset day of the month
    resetTime.setHours(21, 0, 0, 0); // Set to 9 PM

    // If today is past the reset day or it’s the reset day and after 9 PM, set to the next month
    if (now.getDate() > todo.resetDayOfMonth || (now.getDate() === todo.resetDayOfMonth && (now < lastReset && now > resetTime))) {
      resetTime.setMonth(resetTime.getMonth() + 1);
    }
    return now >= resetTime;
  }

  return false;
}

// Check and reset todos if needed
export const checkAndResetTodos = async () => {
  const db = await dbPromise;
  const todos = await db.getAll('todos');

  for (const todo of todos) {
    if (shouldResetTask(todo)) {
      todo.completed = false;  // Reset the task
      todo.lastReset = new Date().toISOString();  // Update last reset time
      await db.put('todos', todo);
    }
  }
};

// Call this function when the app is loaded to check for resets
checkAndResetTodos();