from flask import Flask, jsonify, request, abort
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# Mock database (in-memory list)
todo_list = [
    {"id": 1, "task": "Buy groceries", "completed": False},
    {"id": 2, "task": "Walk the dog", "completed": False}
]

# Helper function to find a todo by id
def find_todo(todo_id):
    return next((todo for todo in todo_list if todo["id"] == todo_id), None)

# Get all todos
@app.route('/todos', methods=['GET'])
def get_todos():
    return jsonify(todo_list), 200

# Get a single todo by id
@app.route('/todos/<int:todo_id>', methods=['GET'])
def get_todo(todo_id):
    todo = find_todo(todo_id)
    if todo is None:
        return abort(404, description="Todo not found")
    return jsonify(todo), 200

# Create a new todo
@app.route('/todos', methods=['POST'])
def create_todo():
    if not request.json or "task" not in request.json:
        return abort(400, description="Task is required")
    
    new_todo = {
        "id": todo_list[-1]["id"] + 1 if todo_list else 1,
        "task": request.json["task"],
        "completed": request.json.get("completed", False)
    }
    todo_list.append(new_todo)
    return jsonify(new_todo), 201

# Update an existing todo
@app.route('/todos/<int:todo_id>', methods=['PUT'])
def update_todo(todo_id):
    todo = find_todo(todo_id)
    if todo is None:
        return abort(404, description="Todo not found")
    
    if not request.json:
        return abort(400, description="Invalid input")
    
    todo["task"] = request.json.get("task", todo["task"])
    todo["completed"] = request.json.get("completed", todo["completed"])
    return jsonify(todo), 200

# Delete a todo
@app.route('/todos/<int:todo_id>', methods=['DELETE'])
def delete_todo(todo_id):
    todo = find_todo(todo_id)
    if todo is None:
        return abort(404, description="Todo not found")
    
    todo_list.remove(todo)
    return jsonify({"message": "Todo deleted"}), 200

if __name__ == '__main__':
    app.run(debug=True)