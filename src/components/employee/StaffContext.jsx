"use client";

import { createContext, useContext } from "react";

/**
 * Who is signed in, for CLIENT components too deep to hand props to.
 *
 * The server layout already tells EmployeeShell the staff name and role;
 * this hands the same two facts to leaf components (the call button, and
 * whatever needs a role check next) without threading them through every
 * server page in between. Display and affordance gating only — every action
 * re-checks the role on the server, where it counts.
 */
const StaffContext = createContext({ name: "", role: "" });

export function StaffProvider({ name, role, children }) {
  return <StaffContext.Provider value={{ name, role }}>{children}</StaffContext.Provider>;
}

export function useStaff() {
  return useContext(StaffContext);
}
