from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Change this in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models
class TodoBase(BaseModel):
    task: str
    completed: Optional[bool] = False

class Todo(TodoBase):
    id: int

# Mock database (in-memory)
todo_list: List[Todo] = [
    Todo(id=1, task="Buy groceries", completed=False),
    Todo(id=2, task="Walk the dog", completed=False)
]

# Helper function
def find_todo(todo_id: int) -> Optional[Todo]:
    return next((todo for todo in todo_list if todo.id == todo_id), None)

# Get all todos
@app.get("/todos", response_model=List[Todo])
def get_todos():
    return todo_list

# Get a single todo
@app.get("/todos/{todo_id}", response_model=Todo)
def get_todo(todo_id: int):
    todo = find_todo(todo_id)
    if not todo:
        raise HTTPException(status_code=404, detail="Todo not found")
    return todo

# Create a new todo
@app.post("/todos", response_model=Todo, status_code=201)
def create_todo(new_todo: TodoBase):
    new_id = todo_list[-1].id + 1 if todo_list else 1
    todo = Todo(id=new_id, **new_todo.dict())
    todo_list.append(todo)
    return todo

# Update a todo
@app.put("/todos/{todo_id}", response_model=Todo)
def update_todo(todo_id: int, updated_data: TodoBase):
    todo = find_todo(todo_id)
    if not todo:
        raise HTTPException(status_code=404, detail="Todo not found")
    todo.task = updated_data.task
    todo.completed = updated_data.completed
    return todo

# Delete a todo
@app.delete("/todos/{todo_id}")
def delete_todo(todo_id: int):
    todo = find_todo(todo_id)
    if not todo:
        raise HTTPException(status_code=404, detail="Todo not found")
    todo_list.remove(todo)
    return {"message": "Todo deleted"}
