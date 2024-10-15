import { openDB, DBSchema } from 'idb';

interface Todo {
  id?: number;  // id is optional when adding a new todo
  task: string;
  completed: boolean;
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

export const addTodo = async (task: string) => {
  const db = await dbPromise;
  await db.add('todos', { task, completed: false });
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
