'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';

type Contact = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string;
  company: string | null;
};

interface AutocompleteProps {
  contacts: Contact[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  allowMultiple?: boolean;
}

export function Autocomplete({
  contacts,
  value,
  onChange,
  placeholder = 'Search contacts...',
  label,
  allowMultiple = false,
}: AutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Parse current value into selected contacts
  const selectedEmails = useMemo(() => {
    return value.split(',').map((e) => e.trim()).filter(Boolean);
  }, [value]);

  // Filter contacts based on input
  const filteredContacts = useMemo(() => {
    if (!inputValue) return contacts;
    const search = inputValue.toLowerCase();
    return contacts.filter(
      (c) =>
        c.email.toLowerCase().includes(search) ||
        c.firstName?.toLowerCase().includes(search) ||
        c.lastName?.toLowerCase().includes(search) ||
        c.company?.toLowerCase().includes(search)
    );
  }, [contacts, inputValue]);

  // Get contact by email
  const getContact = (email: string) => {
    return contacts.find((c) => c.email === email);
  };

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onChange(newValue);
    setIsOpen(true);
    setHighlightedIndex(-1);
  };

  // Add email to selection
  const addEmail = (email: string) => {
    const trimmed = email.trim();
    if (!trimmed) return;

    const newEmails = allowMultiple
      ? [...selectedEmails.filter((e) => e !== trimmed), trimmed]
      : [trimmed];

    onChange(newEmails.join(', '));
    setInputValue('');
    setIsOpen(false);
    inputRef.current?.focus();
  };

  // Remove email from selection
  const removeEmail = (email: string) => {
    const newEmails = selectedEmails.filter((e) => e !== email);
    onChange(newEmails.join(', '));
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setIsOpen(true);
        setHighlightedIndex(0);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < filteredContacts.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && filteredContacts[highlightedIndex]) {
          addEmail(filteredContacts[highlightedIndex].email);
        } else if (inputValue && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inputValue)) {
          addEmail(inputValue);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setHighlightedIndex(-1);
        break;
      case 'Backspace':
        if (!inputValue && selectedEmails.length > 0) {
          removeEmail(selectedEmails[selectedEmails.length - 1]);
        }
        break;
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Sync with external value changes
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  return (
    <div className="relative" ref={wrapperRef}>
      {label && (
        <label className="mb-1 block text-xs font-medium text-gray-500">
          {label}
        </label>
      )}

      {/* Selected emails (for multiple mode) */}
      {allowMultiple && selectedEmails.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {selectedEmails.map((email) => {
            const contact = getContact(email);
            return (
              <span
                key={email}
                className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-700"
              >
                {contact
                  ? [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
                    contact.email
                  : email}
                <button
                  type="button"
                  onClick={() => removeEmail(email)}
                  className="cursor-pointer hover:text-blue-900"
                >
                  <X size={12} />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Input field */}
      <div className="relative">
        <input
          ref={inputRef}
          type="email"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          autoComplete="off"
        />

        {/* Dropdown */}
        {isOpen && filteredContacts.length > 0 && (
          <div className="absolute left-0 right-0 z-20 mt-1 max-h-60 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
            {filteredContacts.map((contact, index) => (
              <button
                key={contact.id}
                onClick={() => addEmail(contact.email)}
                className={`flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                  index === highlightedIndex ? 'bg-gray-50' : ''
                }`}
              >
                <span className="font-medium">
                  {[contact.firstName, contact.lastName]
                    .filter(Boolean)
                    .join(' ') || contact.email}
                </span>
                <span className="text-xs text-gray-400">{contact.email}</span>
              </button>
            ))}
          </div>
        )}

        {/* Show hint when no matches but valid email */}
        {isOpen && inputValue && filteredContacts.length === 0 && (
          <div className="absolute left-0 right-0 z-20 mt-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-500 shadow-lg">
            Press Enter to add &quot;{inputValue}&quot;
          </div>
        )}
      </div>
    </div>
  );
}
