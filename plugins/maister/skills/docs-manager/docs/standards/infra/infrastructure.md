## Infrastructure as Code

### Least Privilege
Grant the actions and resources the workload uses, by name: no `*` in IAM actions or resources, no `0.0.0.0/0` ingress except to a public load balancer, and storage private unless the task says otherwise.

### Plan, Never Apply
Show an infrastructure change as a plan or diff (`terraform plan`, `helm diff`, `kubectl diff`). Never apply, destroy or import against a real environment yourself: that step belongs to a person.
