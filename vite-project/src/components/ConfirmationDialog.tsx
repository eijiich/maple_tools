// src/components/ConfirmationDialogtsx
import React from 'react';
import { Dialog, Description, DialogPanel, DialogTitle } from '@headlessui/react';

interface ConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({ isOpen, onClose, onConfirm }) => {
  return (
    <Dialog open={isOpen} onClose={onClose}>
      <div className="fixed inset-0 bg-black opacity-30" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="max-w-sm mx-auto bg-gray-800 rounded-lg shadow-lg">
          <DialogTitle className="text-lg font-bold p-4">Confirm Removal</DialogTitle>
          <Description className="p-4">
            Are you sure you want to remove this task?
          </Description>
          <div className="flex justify-end p-4">
            <button
              className="mr-2 px-4 py-2 bg-gray-500 rounded-lg"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="px-4 py-2 bg-red-500 text-white rounded-lg"
              onClick={onConfirm}
            >
              Remove
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
};

export default ConfirmationDialog;
