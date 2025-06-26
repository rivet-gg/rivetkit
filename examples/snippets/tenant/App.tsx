import { createClient } from "@rivetkit/actor/client";
import { createReactRivetKit } from "@rivetkit/react";
import { useState, useEffect } from "react";
import type { Registry } from "../actors/registry";

// Create client and hooks
const client = createClient<Registry>("http://localhost:8080");
const { useActor } = createReactRivetKit(client);

export function OrgDashboard({ orgId }: { orgId: string }) {
  // State for data
  const [members, setMembers] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [error, setError] = useState("");

  // Login as admin or regular user
  const loginAsAdmin = () => {
    setToken("auth:user-1"); // Alice is admin
  };
  
  const loginAsMember = () => {
    setToken("auth:user-2"); // Bob is member
  };
  
  // Authentication token
  const [token, setToken] = useState("");
  
  // Connect to tenant actor with authentication token
  const [{ actor }] = useActor("tenant", { 
    params: { token },
    tags: { orgId }
  });

  // Load data when actor is available
  useEffect(() => {
    if (!actor || !token) return;
    
    const loadData = async () => {
      try {
        // Get members (available to all users)
        const membersList = await actor.getMembers();
        setMembers(membersList);
        
        // Try to get invoices (only available to admins)
        try {
          const invoicesList = await actor.getInvoices();
          setInvoices(invoicesList);
          setError("");
        } catch (err: any) {
          setError(err.message);
        }
      } catch (err) {
        console.error("Failed to load data");
      }
    };
    
    loadData();
  }, [actor, token]);

  // Login screen when not authenticated
  if (!token) {
    return (
      <div>
        <h2>Organization Dashboard</h2>
        <p>Choose a login:</p>
        <button onClick={loginAsAdmin}>Login as Admin (Alice)</button>
        <button onClick={loginAsMember}>Login as Member (Bob)</button>
      </div>
    );
  }

  return (
    <div>
      <h2>Organization Dashboard</h2>
      <p>Logged in as: {token.split(":")[1]}</p>
      
      {/* Members Section - available to all users */}
      <div>
        <h3>Members</h3>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {members.map(member => (
              <tr key={member.id}>
                <td>{member.name}</td>
                <td>{member.email}</td>
                <td>{member.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Invoices Section - only displayed to admins */}
      <div>
        <h3>Invoices</h3>
        {error ? (
          <div style={{ color: "red" }}>{error}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(invoice => (
                <tr key={invoice.id}>
                  <td>{invoice.id}</td>
                  <td>{new Date(invoice.date).toLocaleDateString()}</td>
                  <td>${invoice.amount}</td>
                  <td>{invoice.paid ? "Paid" : "Unpaid"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
